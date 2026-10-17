import {cleanImage,inspectFormat,sha256} from './image-cleaner.mjs';
export async function freshImage(bytes,progress){
 const format=inspectFormat(bytes);
 if(!['png','jpg','webp'].includes(format))throw new Error('Fresh PNG export supports still PNG, JPEG and WebP. Use standard cleaning for GIF animation.');
 // Animated and high-bit-depth sources need their original container to retain fidelity.
 const has=(name)=>bytes.some((_,i)=>name.split('').every((c,j)=>bytes[i+j]===c.charCodeAt(0)));
 if((format==='png'&&(bytes[24]===16||has('acTL')))||(format==='webp'&&has('ANIM')))throw new Error('Animated or 16-bit images require standard cleaning to preserve all frames and bit depth.');
 progress(25,'Rebuilding the image','Rendering in browser sRGB; applying display orientation.');
 const old=await cleanImage(bytes);
 const image=await createImageBitmap(new Blob([bytes],{type:old.mime}));
 let outputImage;
 try{
  if(image.width*image.height>40_000_000)throw new Error('Fresh PNG export is limited to 40 megapixels.');
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});ctx.drawImage(image,0,0);
  const first=await sha256(ctx.getImageData(0,0,canvas.width,canvas.height).data);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob)throw new Error('Browser PNG export failed.');
  const result=await cleanImage(await blob.arrayBuffer());
  outputImage=await createImageBitmap(new Blob([result.bytes],{type:'image/png'}));
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(outputImage,0,0);
  const last=await sha256(ctx.getImageData(0,0,canvas.width,canvas.height).data);
  if(first!==last)throw new Error('Rendered pixels changed during PNG export; output discarded. Use standard cleaning.');
  result.report={...result.report,method:'Fresh PNG from browser-rendered sRGB pixels',removed:[...old.report.removed,'Original container, application headers and profile payloads replaced'],removedCount:old.report.removedCount+1,preserved:['Browser-rendered sRGB appearance','Display orientation applied to pixels'],encodedImageDataIdentical:false,decodedPixelsIdentical:true,renderedPixelSha256:first,inputBytes:bytes.length,scope:'Browser-rendered pixels verified identical. Original color space and compressed encoding are replaced; PNG can be larger. Pixel watermarks and AI visual signals remain. No platform-label guarantee.'};
  return result;
 }finally{image.close();outputImage?.close();}
}
