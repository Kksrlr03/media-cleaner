import './style.css';
import { createIcons, ScanLine, ArrowUpRight, Github, ShieldCheck, Upload, Image, Film, LockKeyhole, Sparkles, FileVideo, FileImage, Replace, MapPinOff, CameraOff, FileX2, CalendarX2, Check, CheckCheck, ChevronDown, Download, ArrowRight, ArrowDownToLine, Plus, Trash2, ScanEye, Fingerprint, HardDrive } from 'lucide';
import { cleanImage, inspectFormat } from './image-cleaner.mjs';

const icons={ScanLine,ArrowUpRight,Github,ShieldCheck,Upload,Image,Film,LockKeyhole,Sparkles,FileVideo,FileImage,Replace,MapPinOff,CameraOff,FileX2,CalendarX2,Check,CheckCheck,ChevronDown,Download,ArrowRight,ArrowDownToLine,Plus,Trash2,ScanEye,Fingerprint,HardDrive};
createIcons({icons});
const $=(id)=>document.getElementById(id);
const videoExtensions=new Set(['mp4','mov','mkv','webm','avi','m4v']);
const imageExtensions=new Set(['png','jpg','jpeg','webp','gif','bmp','tif','tiff']);
let state={file:null,originalUrl:null,outputUrl:null,blob:null,report:null,extension:null,busy:false,generation:0};
let videoTools=null,toastTimer;
const transientUrls=new Set();
const formatSize=(bytes)=>bytes<1024?`${bytes} B`:bytes<1024*1024?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1024/1024).toFixed(2)} MB`;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function status(message){$('status').textContent=message;$('status').hidden=!message;}
function progress(percent,title,detail){$('busy-title').textContent=title;$('busy-detail').textContent=detail;$('progress-text').textContent=title;$('progress-percent').textContent=percent?`${percent}%`:'';if(percent)$('progress').value=percent;else $('progress').removeAttribute('value');}
function currentStep(step){for(const [index,name] of ['select','clean','save'].entries()){$(`step-${name}`).classList.toggle('current',index===step);$(`step-${name}`).classList.toggle('done',index<step);}}
function setBusy(busy){state.busy=busy;$('busy-overlay').hidden=!busy;$('progress-wrap').hidden=!busy;$('cancel-button').hidden=!busy;$('clean-button').disabled=busy||!state.file;$('change-button').disabled=busy;}
function reset({message='',release=true}={}){
  state.generation++;
  if(state.originalUrl)URL.revokeObjectURL(state.originalUrl);
  if(state.outputUrl)URL.revokeObjectURL(state.outputUrl);
  for(const url of transientUrls)URL.revokeObjectURL(url);
  transientUrls.clear();
  if(release)videoTools?.releaseVideoEngine();
  const generation=state.generation;
  state={file:null,originalUrl:null,outputUrl:null,blob:null,report:null,extension:null,busy:false,generation};
  $('image-preview').removeAttribute('src');$('video-preview').pause();$('video-preview').removeAttribute('src');$('video-preview').load();
  $('file-input').value='';$('drop-zone').hidden=false;$('media-stage').hidden=true;
  $('result-summary').hidden=true;$('capabilities').hidden=false;$('filename-section').hidden=true;$('result-actions').hidden=true;
  $('download-button').hidden=true;$('clean-button').hidden=false;$('clean-button').disabled=true;
  $('control-title').innerHTML='Less information.<br>Same impression.';$('control-copy').textContent='Remove personal and descriptive metadata while keeping your media looking exactly as it should.';
  $('state-badge').textContent='Ready when you are';$('state-badge').classList.remove('ready');
  $('action-note').textContent='Choose a file to get started. Your original stays untouched.';$('after-tab').disabled=true;
  $('before-tab').classList.add('active');$('after-tab').classList.remove('active');$('before-tab').setAttribute('aria-selected','true');$('after-tab').setAttribute('aria-selected','false');
  setBusy(false);currentStep(0);status('');if(message)toast(message);
}
function preview(cleaned=false){
  const isVideo=videoExtensions.has(state.file?.name.split('.').pop().toLowerCase());
  const element=isVideo?$('video-preview'):$('image-preview');
  $('image-preview').hidden=isVideo;$('video-preview').hidden=!isVideo;$('preview-fallback').hidden=true;
  element.src=cleaned?state.outputUrl:state.originalUrl;
  element.onerror=()=>{element.hidden=true;$('preview-fallback').hidden=false;};
  $('before-tab').classList.toggle('active',!cleaned);$('after-tab').classList.toggle('active',cleaned);
  $('before-tab').setAttribute('aria-selected',String(!cleaned));$('after-tab').setAttribute('aria-selected',String(cleaned));
  $('preview-label').textContent=cleaned?'CLEANED COPY':'ORIGINAL FILE';
}
async function selectFile(file){
  if(state.busy)return;
  const extension=file.name.split('.').pop().toLowerCase(),isVideo=videoExtensions.has(extension);
  if(!isVideo&&!imageExtensions.has(extension)){status('Choose a supported image or video file. PDFs, archives and executable files are not accepted.');return;}
  const limit=(isVideo?100:50)*1024*1024;
  if(!file.size){status('This file is empty. Choose another file.');return;}
  if(file.size>limit){status(`Choose ${isVideo?'a video under 100 MB':'an image under 50 MB'} so processing stays reliable in your browser.`);return;}
  reset({release:false});
  state.file=file;state.originalUrl=URL.createObjectURL(file);
  $('drop-zone').hidden=true;$('media-stage').hidden=false;$('file-name').textContent=file.name;
  $('file-details').textContent=`${formatSize(file.size)}  ·  ${extension.toUpperCase()} ${isVideo?'video':'image'}  ·  Original`;
  $('clean-button').disabled=false;$('state-badge').textContent='File selected';$('action-note').textContent='Ready to clean. Your original stays untouched.';
  currentStep(1);preview(false);
}
function showResult(result){
  state.blob=result.blob||new Blob([result.bytes],{type:result.mime});state.extension=result.extension;state.report={...result.report,inputFilename:state.file.name};
  state.outputUrl=URL.createObjectURL(state.blob);
  $('after-tab').disabled=false;preview(true);
  $('capabilities').hidden=true;$('result-summary').hidden=false;$('filename-section').hidden=false;$('result-actions').hidden=false;
  $('clean-button').hidden=true;$('download-button').hidden=false;
  $('control-title').textContent='The same media. A cleaner copy.';
  $('control-copy').textContent='Your cleaned file is ready. Switch between Original and Cleaned, then choose where to save it.';
  $('state-badge').textContent='Verified';$('state-badge').classList.add('ready');
  $('removed-count').textContent=String(state.report.removedCount);$('output-size').textContent=formatSize(state.blob.size);
  $('output-name').value=state.file.name.replace(/\.[^.]+$/,'')+'-clean';$('output-extension').textContent='.'+state.extension;
  $('action-note').textContent='Delete clears this tab’s working copy. Downloaded files stay on your device.';
  $('file-details').textContent=`${formatSize(state.blob.size)}  ·  ${state.extension.toUpperCase()}  ·  Quality preserved`;
  const details=$('verification-content');details.replaceChildren();
  const note=document.createElement('p');note.className='verified-note';note.textContent=state.report.encodedStreamsIdentical?'Encoded video + audio hashes match. No re-encoding.':state.report.decodedPixelsIdentical?'Decoded image pixels verified unchanged. Lossless PNG export.':'Encoded image data hashes match. No recompression.';details.append(note);
  for(const [title,items] of [['Removed',state.report.removed],['Preserved for correct display',state.report.preserved]]){
    const heading=document.createElement('h4');heading.textContent=title;details.append(heading);
    const list=document.createElement('ul');
    for(const value of items.length?items:['No matching descriptive fields found.']){const item=document.createElement('li');item.textContent=value;list.append(item);}details.append(list);
  }
  const scope=document.createElement('p');scope.textContent=state.report.scope;details.append(scope);
  currentStep(2);toast('Cleaned and verified. Your original is untouched.');
}
async function clean(){
  if(!state.file||state.busy)return;
  const generation=state.generation;
  setBusy(true);status('');progress(5,'Preparing your clean copy','Checking the file before changing any metadata.');
  try{
    let result;
    const ext=state.file.name.split('.').pop().toLowerCase();
    if(videoExtensions.has(ext)){
      videoTools=await import('./video-cleaner.js');
      if(generation!==state.generation)return;
      result=await videoTools.cleanVideo(state.file,progress);
    }else{
      const bytes=new Uint8Array(await state.file.arrayBuffer());
      if(generation!==state.generation)return;
      if(!inspectFormat(bytes)&&['bmp','tif','tiff'].includes(ext)){
        videoTools=await import('./video-cleaner.js');result=await videoTools.cleanRasterImage(state.file,progress);
      }else{
        progress(35,'Removing descriptive metadata','Keeping encoded image data, colors and orientation intact.');
        await new Promise(resolve=>setTimeout(resolve,30));result=await cleanImage(bytes);
      }
    }
    if(generation!==state.generation)return;
    setBusy(false);showResult(result);
  }catch(error){
    if(generation!==state.generation)return;
    setBusy(false);status(typeof error==='string'?error:error.message||'This file could not be cleaned safely. Your original is unchanged.');
    $('state-badge').textContent='Try another file';
  }
}
function safeName(value,extension){const clean=value.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/,'').trim().slice(0,100)||'cleaned-media';return `${clean.replace(new RegExp(`\\.${extension}$`,'i'),'')}.${extension}`;}
async function downloadBlob(blob,name,mime,extension){
  if(state.file&&name.toLowerCase()===state.file.name.toLowerCase())throw new Error('Choose a different filename to protect your original.');
  if(typeof window.showSaveFilePicker==='function'){
    try{
      const handle=await window.showSaveFilePicker({suggestedName:name,types:[{description:extension.toUpperCase()+' file',accept:{[mime]:['.'+extension]}}]});
      if(state.file&&handle.name?.toLowerCase()===state.file.name.toLowerCase())throw new Error('Choose a different filename to protect your original.');
      const writable=await handle.createWritable();try{await writable.write(blob);await writable.close();}catch(error){await writable.abort().catch(()=>{});throw error;}
      toast('Saved. Your cleaned file is still available in this tab.');return;
    }catch(error){if(error.name==='AbortError'){toast('Save cancelled. Your cleaned file is still ready.');return;}if(error.name!=='SecurityError')throw error;}
  }
  const url=URL.createObjectURL(blob),link=document.createElement('a');transientUrls.add(url);link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>{URL.revokeObjectURL(url);transientUrls.delete(url);},60000);toast('Download started. Your browser chooses the save location.');
}
$('file-input').addEventListener('change',event=>{if(event.target.files[0])selectFile(event.target.files[0]);});
$('drop-zone').addEventListener('click',()=>$('file-input').click());$('change-button').addEventListener('click',()=>$('file-input').click());
for(const name of ['dragenter','dragover'])$('drop-zone').addEventListener(name,event=>{event.preventDefault();$('drop-zone').classList.add('dragging');});
for(const name of ['dragleave','drop'])$('drop-zone').addEventListener(name,event=>{event.preventDefault();$('drop-zone').classList.remove('dragging');});
$('drop-zone').addEventListener('drop',event=>{const files=event.dataTransfer.files;if(files.length===1)selectFile(files[0]);else status('Choose one file at a time so you can review every cleaned result.');});
window.addEventListener('dragover',event=>event.preventDefault());window.addEventListener('drop',event=>event.preventDefault());
$('before-tab').addEventListener('click',()=>preview(false));$('after-tab').addEventListener('click',()=>{if(state.outputUrl)preview(true);});
$('clean-button').addEventListener('click',clean);
$('download-button').addEventListener('click',async()=>{if(!state.blob)return;try{await downloadBlob(state.blob,safeName($('output-name').value,state.extension),state.blob.type,state.extension);}catch(error){status('The file could not be saved: '+error.message);}});
$('report-button').addEventListener('click',async()=>{if(!state.report)return;try{await downloadBlob(new Blob([JSON.stringify(state.report,null,2)],{type:'application/json'}),safeName($('output-name').value+'-report','json'),'application/json','json');}catch(error){status(error.message);}});
$('delete-button').addEventListener('click',()=>reset({message:'Working copies deleted from this tab. Original and downloaded files are untouched.'}));
$('another-button').addEventListener('click',()=>{reset();$('file-input').click();});
$('cancel-button').addEventListener('click',()=>reset({message:'Processing cancelled. Temporary media cleared.'}));
$('how-button').addEventListener('click',()=>$('how-it-works').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));
window.addEventListener('pagehide',()=>{if(state.originalUrl)URL.revokeObjectURL(state.originalUrl);if(state.outputUrl)URL.revokeObjectURL(state.outputUrl);for(const url of transientUrls)URL.revokeObjectURL(url);transientUrls.clear();videoTools?.releaseVideoEngine();});
