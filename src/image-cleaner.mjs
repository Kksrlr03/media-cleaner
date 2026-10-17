// Container editing only: compressed image samples are never re-encoded.
const text = (bytes) => new TextDecoder('latin1').decode(bytes);
const ascii = (str) => Uint8Array.from(str, (c) => c.charCodeAt(0));
export function join(parts) {
  const output = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
export async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) => n.toString(16).padStart(2, '0')).join('');
}
function requireBytes(condition, message = 'This image has an invalid or unsupported structure.') {
  if (!condition) throw new Error(message);
}
function orientation(data) {
  try {
    const start = text(data.subarray(0, 6)) === 'Exif\0\0' ? 6 : 0;
    const view = new DataView(data.buffer, data.byteOffset + start, data.length - start);
    const little = view.getUint16(0) === 0x4949;
    if (!little && view.getUint16(0) !== 0x4d4d) return 1;
    if (view.getUint16(2, little) !== 42) return 1;
    const offset = view.getUint32(4, little), count = view.getUint16(offset, little);
    for (let i = 0; i < Math.min(count, 4096); i++) {
      const pos = offset + 2 + i * 12;
      if (view.getUint16(pos, little) === 274 && view.getUint16(pos + 2, little) === 3 && view.getUint32(pos + 4, little) === 1) {
        const value = view.getUint16(pos + 8, little);
        return value >= 1 && value <= 8 ? value : 1;
      }
    }
  } catch {}
  return 1;
}
function minimalExif(value, prefix = false) {
  const tiff = new Uint8Array([73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,value,0,0,0,0,0,0,0]);
  return prefix ? join([ascii('Exif\0\0'), tiff]) : tiff;
}
let crcTable;
export function crc32(bytes) {
  crcTable ||= Uint32Array.from({ length: 256 }, (_, i) => {
    let c = i; for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const value of bytes) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function pngChunk(kind, payload) {
  const output = new Uint8Array(payload.length + 12), view = new DataView(output.buffer);
  view.setUint32(0, payload.length); output.set(ascii(kind), 4); output.set(payload, 8);
  view.setUint32(output.length - 4, crc32(output.subarray(4, output.length - 4)));
  return output;
}
function cleanPng(bytes) {
  const keep = new Set(['IHDR','PLTE','IDAT','IEND','tRNS','cHRM','gAMA','iCCP','sRGB','sBIT','cICP','mDCV','cLLI','acTL','fcTL','fdAT']);
  const rendering = new Set(['tRNS','cHRM','gAMA','iCCP','sRGB','sBIT','cICP','mDCV','cLLI']);
  const parts = [bytes.subarray(0, 8)], imageData = [], removed = [], preserved = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  let pos = 8, ended = false, sawImage = false, sawHeader = false;
  while (pos < bytes.length) {
    requireBytes(pos + 12 <= bytes.length);
    const size = view.getUint32(pos), end = pos + size + 12;
    requireBytes(end <= bytes.length);
    const kind = text(bytes.subarray(pos + 4, pos + 8));
    requireBytes(crc32(bytes.subarray(pos + 4, end - 4)) === view.getUint32(end - 4), 'PNG checksum failed. The original file was not modified.');
    if (!sawHeader) requireBytes(kind === 'IHDR' && size === 13);
    if (kind === 'IHDR') { requireBytes(!sawHeader); sawHeader = true; }
    if (kind === 'IDAT') sawImage = true;
    if (kind === 'eXIf') {
      const value = orientation(bytes.subarray(pos + 8, end - 4));
      removed.push('EXIF camera, location and descriptive fields');
      if (value !== 1) { parts.push(pngChunk('eXIf', minimalExif(value))); preserved.push('Display orientation'); }
    } else if (keep.has(kind)) {
      parts.push(bytes.subarray(pos, end));
      if (['IDAT','fdAT','fcTL','acTL','IHDR','PLTE'].includes(kind)) imageData.push(bytes.subarray(pos, end));
      if (rendering.has(kind)) preserved.push(`Rendering information (${kind})`);
    } else {
      requireBytes(kind[0] === kind[0].toLowerCase(), `Unknown critical PNG chunk ${kind}; skipped to preserve the image.`);
      removed.push(({ tEXt:'Text / generation workflow', iTXt:'XMP / text / content credentials', zTXt:'Compressed text', pHYs:'Print resolution', tIME:'Timestamp' })[kind] || `Optional ${kind} data`);
    }
    pos = end;
    if (kind === 'IEND') { requireBytes(size === 0); ended = true; break; }
  }
  requireBytes(ended && sawImage);
  if (pos < bytes.length) removed.push('Trailing file data');
  return { bytes: join(parts), imageData: join(imageData), removed, preserved, mime:'image/png', extension:'png' };
}
function jpegSegment(marker, payload) {
  const size = payload.length + 2;
  return join([new Uint8Array([255, marker, size >>> 8, size & 255]), payload]);
}
function cleanJpeg(bytes) {
  const parts = [bytes.subarray(0,2)], imageData = [], removed = [], preserved = [];
  let pos = 2, ended = false, scans = 0;
  while (pos < bytes.length) {
    requireBytes(bytes[pos] === 255);
    const start = pos;
    while (bytes[pos] === 255) pos++;
    const marker = bytes[pos++];
    if (marker === 0xd9) { parts.push(bytes.subarray(start,pos)); ended = true; break; }
    requireBytes(marker !== 0 && marker !== 0xd8);
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 1) { parts.push(bytes.subarray(start,pos)); continue; }
    requireBytes(pos + 2 <= bytes.length);
    const length = bytes[pos] * 256 + bytes[pos+1], end = pos + length;
    requireBytes(length >= 2 && end <= bytes.length);
    const payload = bytes.subarray(pos+2,end);
    if (marker === 0xe1) {
      const value = orientation(payload);
      removed.push('EXIF / GPS / XMP / descriptive fields');
      if (text(payload.subarray(0,6)) === 'Exif\0\0' && value !== 1) { parts.push(jpegSegment(marker,minimalExif(value,true))); preserved.push('Display orientation'); }
    } else if (marker === 0xe2 && text(payload.subarray(0,12)) === 'ICC_PROFILE\0') {
      parts.push(bytes.subarray(start,end)); preserved.push('ICC color profile');
    } else if (marker === 0xee && text(payload.subarray(0,5)) === 'Adobe' && payload.length === 12) {
      parts.push(bytes.subarray(start,end)); preserved.push('Adobe color transform');
    } else if (marker === 0xe0 && text(payload.subarray(0,5)) === 'JFIF\0' && payload.length >= 14) {
      const basic = payload.slice(0,14); basic[12] = 0; basic[13] = 0;
      parts.push(jpegSegment(marker,basic)); preserved.push('JFIF rendering header');
      if (payload.length > 14) removed.push('Embedded thumbnail');
    } else if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      removed.push(marker === 0xfe ? 'Comment' : `Application metadata (APP${marker-0xe0})`);
    } else {
      parts.push(bytes.subarray(start,end)); imageData.push(bytes.subarray(start,end));
    }
    pos = end;
    if (marker === 0xda) {
      scans++;
      const beginScan = pos;
      while (pos < bytes.length) {
        if (bytes[pos] !== 255) { pos++; continue; }
        let next = pos + 1;
        while (bytes[next] === 255) next++;
        if (bytes[next] === 0 || (bytes[next] >= 0xd0 && bytes[next] <= 0xd7)) { pos = next+1; continue; }
        break;
      }
      parts.push(bytes.subarray(beginScan,pos)); imageData.push(bytes.subarray(beginScan,pos));
    }
  }
  requireBytes(ended && scans > 0);
  if (pos < bytes.length) removed.push('Trailing file data');
  return { bytes:join(parts), imageData:join(imageData), removed,preserved,mime:'image/jpeg',extension:'jpg' };
}
function cleanWebp(bytes) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
  const total = view.getUint32(4,true) + 8;
  requireBytes(total <= bytes.length && total >= 12);
  const parts = [], imageData = [], removed = [], preserved = [];
  let pos = 12, extended = null, retainedExif = false, foundImage = false;
  const allowed = new Set(['VP8X','VP8 ','VP8L','ALPH','ANIM','ANMF','ICCP']);
  while (pos < total) {
    requireBytes(pos+8 <= total);
    const kind = text(bytes.subarray(pos,pos+4)), size = view.getUint32(pos+4,true), end = pos+8+size+(size&1);
    requireBytes(end <= total);
    if (kind === 'EXIF') {
      const data = bytes.subarray(pos+8,pos+8+size), value = orientation(data);
      removed.push('EXIF / GPS / camera information');
      if (value !== 1) {
        const exif = minimalExif(value,text(data.subarray(0,6)) === 'Exif\0\0');
        const chunk = new Uint8Array(8+exif.length+(exif.length&1)); chunk.set(ascii('EXIF'));
        new DataView(chunk.buffer).setUint32(4,exif.length,true); chunk.set(exif,8); parts.push(chunk);
        retainedExif = true; preserved.push('Display orientation');
      }
    } else if (allowed.has(kind)) {
      const chunk = bytes.slice(pos,end);
      if (kind === 'VP8X') extended = chunk;
      if (kind === 'ICCP') preserved.push('ICC color profile');
      else if (kind !== 'VP8X') imageData.push(chunk);
      if (['VP8 ','VP8L','ANMF'].includes(kind)) foundImage = true;
      parts.push(chunk);
    } else removed.push(kind === 'XMP ' ? 'XMP / content credentials' : `Optional ${kind} data`);
    pos = end;
  }
  requireBytes(foundImage);
  if (extended) extended[8] = (extended[8] & ~12) | (retainedExif ? 8 : 0);
  const content = join([ascii('WEBP'),...parts]), header = new Uint8Array(8);
  header.set(ascii('RIFF')); new DataView(header.buffer).setUint32(4,content.length,true);
  if (total < bytes.length) removed.push('Trailing file data');
  return {bytes:join([header,content]),imageData:join(imageData),removed,preserved,mime:'image/webp',extension:'webp'};
}
function cleanGif(bytes) {
  requireBytes(bytes.length >= 14);
  let pos = 13 + ((bytes[10]&128) ? 3*(1<<((bytes[10]&7)+1)) : 0);
  requireBytes(pos <= bytes.length);
  const parts=[bytes.subarray(0,pos)], imageData=[bytes.subarray(0,pos)], removed=[],preserved=[];
  const subBlocks=()=>{ while (true) { requireBytes(pos < bytes.length); const size=bytes[pos++]; requireBytes(pos+size<=bytes.length); pos+=size; if (!size) return; } };
  let frames=0,ended=false;
  while(pos<bytes.length) {
    const start=pos, kind=bytes[pos++];
    if(kind===0x3b){parts.push(bytes.subarray(start,pos)); ended=true;break;}
    if(kind===0x2c){
      requireBytes(pos+9<=bytes.length); const packed=bytes[pos+8]; pos+=9;
      if(packed&128)pos+=3*(1<<((packed&7)+1));
      requireBytes(pos<bytes.length);pos++;subBlocks();frames++;
      parts.push(bytes.subarray(start,pos));imageData.push(bytes.subarray(start,pos));
    } else if(kind===0x21){
      requireBytes(pos<bytes.length);const label=bytes[pos++], headerPos=pos;subBlocks();
      const id=text(bytes.subarray(headerPos+1,headerPos+12));
      if(label===0xf9 || label===0x01 || (label===0xff && ['NETSCAPE2.0','ANIMEXTS1.0','ICCRGBG1012'].includes(id))){
        parts.push(bytes.subarray(start,pos));imageData.push(bytes.subarray(start,pos));
        if(label===0xff)preserved.push(id==='ICCRGBG1012'?'ICC color profile':'Animation timing and loop');
      } else removed.push(label===0xfe?'Comment':'Application metadata');
    } else throw new Error('Unsupported GIF structure. The original was not modified.');
  }
  requireBytes(ended&&frames>0);
  if(pos<bytes.length)removed.push('Trailing file data');
  return{bytes:join(parts),imageData:join(imageData),removed,preserved,mime:'image/gif',extension:'gif'};
}
export function inspectFormat(bytes) {
  if(bytes[0]===137&&text(bytes.subarray(1,8))==='PNG\r\n\x1a\n')return'png';
  if(bytes[0]===255&&bytes[1]===216)return'jpg';
  if(text(bytes.subarray(0,4))==='RIFF'&&text(bytes.subarray(8,12))==='WEBP')return'webp';
  if(['GIF87a','GIF89a'].includes(text(bytes.subarray(0,6))))return'gif';
  return null;
}
function parse(bytes){
  const format=inspectFormat(bytes);
  if(format==='png')return cleanPng(bytes);
  if(format==='jpg')return cleanJpeg(bytes);
  if(format==='webp')return cleanWebp(bytes);
  if(format==='gif')return cleanGif(bytes);
  throw new Error('Choose a PNG, JPEG, WebP or GIF image. This format cannot be cleaned without a conversion.');
}
export async function cleanImage(input) {
  const source = input instanceof Uint8Array ? input : new Uint8Array(input);
  const output = parse(source), recheck=parse(output.bytes);
  const originalHash=await sha256(output.imageData), cleanedHash=await sha256(recheck.imageData);
  requireBytes(originalHash===cleanedHash,'Image data verification failed. No output was produced.');
  requireBytes(recheck.bytes.length===output.bytes.length && recheck.bytes.every((value,i)=>value===output.bytes[i]),'Metadata verification failed.');
  return {...output,report:{
    version:1,kind:'image',method:'Lossless container cleaning; no pixel recompression',
    format:output.extension,removed:[...new Set(output.removed)],removedCount:output.removed.length,
    preserved:[...new Set(output.preserved)],encodedImageDataIdentical:true,
    imageDataSha256:originalHash,outputSha256:await sha256(output.bytes),
    inputBytes:source.length,outputBytes:output.bytes.length,
    scope:'Descriptive metadata is removed. Necessary color/orientation/animation information is retained. Pixel watermarks and platform labels are outside this check.'
  }};
}
