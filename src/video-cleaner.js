let engine = null;
let loading = null;
let lastEngineError = '';
const decoder = new TextDecoder();
const allowedContainers = new Set(['mov','mp4','m4a','3gp','3g2','mj2','matroska','webm','avi','mpegts','mpeg']);
const structuralGlobal = new Set(['major_brand','minor_version','compatible_brands','encoder']);
const structuralStream = new Set(['language','handler_name','vendor_id','encoder','duration','rotate']);
const TIMEOUT = 180_000;

export function releaseVideoEngine() {
  if (engine) { try { engine.terminate(); } catch {} }
  engine = null; loading = null;
  lastEngineError='';
}
async function getEngine(onProgress) {
  if (engine?.loaded) return engine;
  if (loading) return loading;
  loading = (async()=>{
    onProgress(2,'Loading local video tools','First use downloads approximately 31 MB. Your media stays on this device.');
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    engine = new FFmpeg();
    engine.on('log', ({ message }) => { lastEngineError = message; });
    const base = new URL(`${import.meta.env.BASE_URL}ffmpeg/`, document.baseURI);
    await engine.load({ coreURL:new URL('ffmpeg-core.js',base).href,wasmURL:new URL('ffmpeg-core.wasm',base).href });
    return engine;
  })();
  try { return await loading; } catch (error) { releaseVideoEngine(); throw new Error('The local video tools could not load. Check your connection and try again.'); }
}
async function probe(ff,path,name) {
  // Core 0.12.10 can leave its return-code sentinel at -1 after a successful
  // ffprobe call. Require a complete, parseable output rather than that sentinel.
  await ff.ffprobe(['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-show_chapters','-of','json',path,'-o',name],TIMEOUT);
  try {
    const info=JSON.parse(decoder.decode(await ff.readFile(name)));
    if(!info.format||!Array.isArray(info.streams))throw new Error();
    return info;
  }catch{throw new Error('This media container could not be read safely. '+lastEngineError);}
}
async function hashes(ff,path,name,indexes) {
  const maps=indexes.flatMap(index=>['-map',`0:${index}`]);
  const code=await ff.exec(['-hide_banner','-loglevel','error','-protocol_whitelist','file,pipe','-i',path,...maps,'-c','copy','-f','streamhash','-hash','sha256',name],TIMEOUT);
  if(code!==0)throw new Error('The media streams could not be verified without conversion. No output was produced.');
  const value=decoder.decode(await ff.readFile(name)).trim();
  if(!value||!value.includes('SHA256='))throw new Error('Media verification returned no stream hashes.');
  return value;
}
function rotation(stream){
  const side=stream.side_data_list?.find(x=>x.rotation!==undefined);
  return Number(side?.rotation ?? stream.tags?.rotate ?? 0);
}
function checkPreservation(before,after){
  if(before.length!==after.length)throw new Error('Stream count changed unexpectedly.');
  for(let i=0;i<before.length;i++){
    for(const key of ['codec_name','codec_type','width','height','pix_fmt','sample_rate','channels','channel_layout','color_range','color_space','color_transfer','color_primaries']){
      if(before[i][key]!==undefined&&after[i][key]!==before[i][key])throw new Error(`Playback property ${key} changed. No output was produced.`);
    }
    if(rotation(before[i])!==rotation(after[i]))throw new Error('Display orientation was not preserved; no output was produced.');
    if(before[i].duration&&after[i].duration&&Math.abs(Number(before[i].duration)-Number(after[i].duration))>.1)throw new Error('Stream duration changed. No output was produced.');
  }
}
function verifyTags(info){
  const retained=[];
  for(const [key,value] of Object.entries(info.format?.tags||{})){
    if(!structuralGlobal.has(key.toLowerCase()))throw new Error(`Unremoved container metadata (${key}). This format cannot be cleaned safely.`);
    if(key.toLowerCase()==='encoder'&&!/^Lavf(?:\d[\w.]*)?$/.test(value))throw new Error('Source encoder metadata was not removed.');
    retained.push(`Container ${key}`);
  }
  for(const stream of info.streams||[]){
    for(const [key,value] of Object.entries(stream.tags||{})){
      if(!structuralStream.has(key.toLowerCase()))throw new Error(`Unremoved stream metadata (${key}). No output was produced.`);
      if(key.toLowerCase()==='handler_name'&&!['VideoHandler','SoundHandler'].includes(value))throw new Error('Source handler metadata was not removed.');
      if(key.toLowerCase()==='language'&&value!=='und')throw new Error('Source language metadata was not reset.');
      if(key.toLowerCase()==='encoder'&&!/^Lav[cf](?:[\w. -]*)?$/.test(value))throw new Error('Source encoder metadata was not removed.');
      retained.push(`Stream ${stream.index}: ${key}`);
    }
  }
  if(info.chapters?.length)throw new Error('Chapter metadata remains.');
  return retained;
}
export async function cleanVideo(file,onProgress){
  const ff=await getEngine(onProgress);
  const extension=file.name.split('.').pop().toLowerCase();
  const outputExtension=extension==='m4v'?'mp4':extension;
  if(!['mp4','mov','mkv','webm','avi'].includes(outputExtension))throw new Error('Choose MP4, MOV, WebM, MKV or AVI video. No conversion is used.');
  const input=`source.${extension}`,output=`cleaned.${outputExtension}`;
  const files=[input,output,'source.json','result.json','source.sha256','result.sha256'];
  try{
    onProgress(12,'Inspecting your video','Checking streams, color and orientation.');
    await ff.writeFile(input,new Uint8Array(await file.arrayBuffer()));
    const before=await probe(ff,input,'source.json');
    if(!before.format?.format_name?.split(',').some(x=>allowedContainers.has(x)))throw new Error('Only regular video files are supported. Playlists and external media references are not accepted.');
    const streams=(before.streams||[]).filter(s=>(s.codec_type==='video'&&!s.disposition?.attached_pic)||s.codec_type==='audio');
    if(!streams.some(s=>s.codec_type==='video'))throw new Error('No playable video stream was found.');
    const selected=[...streams.filter(s=>s.codec_type==='video'),...streams.filter(s=>s.codec_type==='audio')];
    const indexes=selected.map(s=>s.index);
    onProgress(25,'Verifying original streams','Reading encoded video and audio—without changing them.');
    const inputHash=await hashes(ff,input,'source.sha256',indexes);
    const removed=[...Object.keys(before.format?.tags||{}).filter(key=>!['major_brand','minor_version','compatible_brands'].includes(key.toLowerCase()))];
    for(const stream of before.streams||[])for(const key of Object.keys(stream.tags||{}))removed.push(`Stream ${stream.index}: ${key}`);
    if(before.chapters?.length)removed.push(`${before.chapters.length} chapter(s)`);
    const extras=(before.streams||[]).length-selected.length;
    if(extras)removed.push(`${extras} subtitle / attachment / data stream(s)`);
    const maps=indexes.flatMap(index=>['-map',`0:${index}`]);
    const args=['-hide_banner','-loglevel','error','-protocol_whitelist','file,pipe','-i',input,...maps,'-c','copy','-map_metadata','-1','-map_metadata:s','-1','-map_chapters','-1','-metadata','encoder=','-fflags','+bitexact'];
    selected.forEach((stream,index)=>{
      args.push(`-metadata:s:${index}`,'encoder=',`-metadata:s:${index}`,'language=und',`-metadata:s:${index}`,`handler_name=${stream.codec_type==='video'?'VideoHandler':'SoundHandler'}`);
    });
    if(['mp4','mov'].includes(outputExtension))args.push('-movflags','+faststart');
    args.push(output);
    onProgress(50,'Removing video metadata','Copying original media streams. No re-encoding.');
    if(await ff.exec(args,TIMEOUT)!==0)throw new Error('This video cannot be cleaned in its original format without conversion. Your original is unchanged.');
    onProgress(74,'Checking the cleaned copy','Comparing original and cleaned stream fingerprints.');
    const after=await probe(ff,output,'result.json');
    const remaining=verifyTags(after);
    checkPreservation(selected,after.streams||[]);
    const outputHash=await hashes(ff,output,'result.sha256',(after.streams||[]).map(s=>s.index));
    if(inputHash!==outputHash)throw new Error('The encoded video or audio changed. The output was discarded to protect quality.');
    const data=await ff.readFile(output);
    onProgress(100,'Your clean video is ready','Original encoded video and audio verified unchanged.');
    return{blob:new Blob([data],{type:({mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',mkv:'video/x-matroska',avi:'video/x-msvideo'})[outputExtension]}),extension:outputExtension,report:{
      version:1,kind:'video',method:'Lossless stream copy; no video or audio encoding',
      removed:[...new Set(removed)],removedCount:removed.length,preserved:[...new Set([...remaining,'Color / HDR / orientation and codec data','Original encoded video and audio streams'])],
      encodedStreamsIdentical:true,streamFingerprints:outputHash,inputBytes:file.size,outputBytes:data.length,
      scope:'Container and stream descriptive metadata cleaned. Codec-level user data, in-frame watermarks and platform labels are not removed or verified.'
    }};
  }finally{
    for(const path of files){try{await ff.deleteFile(path);}catch{}}
  }
}

function rasterSafety(bytes,extension){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
  if(extension==='bmp'){
    if(bytes.length<54||bytes[0]!==66||bytes[1]!==77)throw new Error('Invalid BMP file.');
    const dib=view.getUint32(14,true);
    if(dib>=124&&bytes.length>=138&&view.getUint32(14+116,true)>0)throw new Error('This BMP contains a custom color profile. It is kept untouched rather than risk a color change.');
    return;
  }
  const little=bytes[0]===73&&bytes[1]===73;
  if(bytes.length<8||(!little&&!(bytes[0]===77&&bytes[1]===77))||view.getUint16(2,little)!==42)throw new Error('Only standard TIFF files are supported for a lossless export.');
  const pos=view.getUint32(4,little);
  if(pos+2>bytes.length)throw new Error('Invalid TIFF structure.');
  const count=view.getUint16(pos,little);
  for(let i=0;i<count;i++){
    const at=pos+2+i*12;
    if(at+12>bytes.length)throw new Error('Invalid TIFF directory.');
    const tag=view.getUint16(at,little);
    if(tag===34675)throw new Error('This TIFF contains a custom ICC profile. It is kept untouched rather than risk a color change.');
    if(tag===274&&view.getUint16(at+8,little)!==1)throw new Error('This TIFF uses a special orientation. Export it to a lossless PNG first to preserve its display.');
    if(tag===339&&view.getUint16(at+8,little)>1)throw new Error('Floating-point TIFF needs a specialist lossless export and is kept untouched.');
  }
}
export async function cleanRasterImage(file,onProgress){
  const extension=file.name.split('.').pop().toLowerCase();
  const source=new Uint8Array(await file.arrayBuffer());
  rasterSafety(source,extension);
  const ff=await getEngine(onProgress);
  const input=`original.${extension}`,output='raster-cleaned.png';
  const files=[input,output,'raster.json','pixels-original.txt','pixels-cleaned.txt'];
  try{
    onProgress(20,'Reading your image','Preparing a lossless PNG export.');
    await ff.writeFile(input,source);
    await ff.ffprobe(['-v','error','-count_frames','-show_streams','-of','json',input,'-o','raster.json'],TIMEOUT);
    const info=JSON.parse(decoder.decode(await ff.readFile('raster.json'))),stream=info.streams?.[0];
    if(!stream||!['bmp','tiff'].includes(stream.codec_name)||Number(stream.nb_read_frames)!==1)throw new Error('Animated, multipage or unsupported images are kept untouched.');
    if(stream.width*stream.height>40_000_000)throw new Error('This image is too large for a reliable in-browser conversion.');
    if(stream.side_data_list?.some(x=>/icc|hdr|mastering|content light/i.test(x.side_data_type)))throw new Error('This image needs special color handling and is kept untouched.');
    const highDepth=/16|48|64|10|12|14/.test(stream.pix_fmt||'');
    const hashArgs=(path,target)=>['-hide_banner','-loglevel','error','-i',path,'-map','0:v:0','-pix_fmt',highDepth?'rgba64le':'rgba','-f','framemd5',target];
    if(await ff.exec(hashArgs(input,'pixels-original.txt'),TIMEOUT)!==0)throw new Error('Original pixels could not be verified.');
    onProgress(50,'Removing image metadata','Preserving the decoded pixels in a lossless PNG.');
    if(await ff.exec(['-hide_banner','-loglevel','error','-i',input,'-map','0:v:0','-frames:v','1','-c:v','png','-pix_fmt',highDepth?'rgba64be':'rgba','-map_metadata','-1',output],TIMEOUT)!==0)throw new Error('A lossless image export was not possible.');
    if(await ff.exec(hashArgs(output,'pixels-cleaned.txt'),TIMEOUT)!==0)throw new Error('Cleaned pixels could not be verified.');
    const digest=async(name)=>decoder.decode(await ff.readFile(name)).split('\n').filter(line=>line&&!line.startsWith('#')).map(line=>line.split(',').slice(-2).map(value=>value.trim()).join(',')).join('\n');
    const first=await digest('pixels-original.txt'),last=await digest('pixels-cleaned.txt');
    if(!first||first!==last)throw new Error('Pixel values changed during export. The output was discarded.');
    const {cleanImage}=await import('./image-cleaner.mjs');
    const cleaned=await cleanImage(await ff.readFile(output));
    cleaned.report.decodedPixelsIdentical=true;
    cleaned.report.method='Lossless PNG export; canonical RGBA pixel hashes match';
    cleaned.report.removed=['Original EXIF / descriptive image metadata',...cleaned.report.removed];
    cleaned.report.removedCount=cleaned.report.removed.length;
    return cleaned;
  }finally{for(const path of files){try{await ff.deleteFile(path);}catch{}}}
}
