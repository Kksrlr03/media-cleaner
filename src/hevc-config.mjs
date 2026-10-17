// Remove optional HEVC SEI arrays from an MP4 configuration record without moving
// sample offsets. Padding is zeroed; the final remux canonicalizes the record.
export function cleanHevcConfig(source){
 const bytes=source.slice(),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);let removed=0;
 const text=(p)=>String.fromCharCode(...bytes.subarray(p,p+4));
 function walk(start,end,depth=0){
  if(depth>12)throw new Error('MP4 nesting exceeds safe parsing limits.');
  for(let p=start;p+8<=end;){
   const size=view.getUint32(p),type=text(p+4);
   if(size===1||size===0)return; // extended-size containers remain unmodified
   if(size<8||p+size>end)return;
   if(['moov','trak','mdia','minf','stbl'].includes(type))walk(p+8,p+size,depth+1);
   else if(type==='stsd'&&size>=16)walk(p+16,p+size,depth+1);
   else if(['hvc1','hev1'].includes(type)&&size>=86)walk(p+86,p+size,depth+1);
   else if(type==='hvcC'&&size>=31){
    const begin=p+8,finish=p+size;
    if(bytes[begin]!==1){p+=size;continue;}
    const count=bytes[begin+22];let at=begin+23;const kept=[];let dropped=0;
    for(let i=0;i<count;i++){
     const first=at;if(at+3>finish)throw new Error('Invalid HEVC configuration arrays.');
     const kind=bytes[at]&63,n=view.getUint16(at+1);at+=3;
     for(let j=0;j<n;j++){
      if(at+2>finish)throw new Error('Invalid HEVC configuration unit.');
      const length=view.getUint16(at);at+=2;
      if(at+length>finish||length<2)throw new Error('Invalid HEVC configuration payload.');
      if(((bytes[at]>>1)&63)!==kind)throw new Error('HEVC configuration unit type mismatch.');
      at+=length;
     }
     if(kind===39||kind===40)dropped++;else kept.push(bytes.slice(first,at));
    }
    if(dropped){bytes.fill(0,begin+23,finish);bytes[begin+22]=kept.length;at=begin+23;for(const block of kept){bytes.set(block,at);at+=block.length;}removed+=dropped;}
   }
   p+=size;
  }
 }
 walk(0,bytes.length);return {bytes,removed};
}
