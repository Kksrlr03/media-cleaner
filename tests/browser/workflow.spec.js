import { test, expect } from '@playwright/test';
import {readFile} from 'node:fs/promises';
const fixtures=JSON.parse(await readFile(new URL('../fixtures.json',import.meta.url),'utf8'));
const types={png:'image/png',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',bmp:'image/bmp',tiff:'image/tiff',mp4:'video/mp4'};
const upload=(page,name)=>page.locator('#file-input').setInputFiles({name:`private-source.${name==='jpeg'?'jpg':name}`,mimeType:types[name],buffer:Buffer.from(fixtures[name],'base64')});
async function waitReady(page){
  await expect.poll(async()=>{
    if(await page.locator('#status').isVisible())throw new Error(await page.locator('#status').innerText());
    return page.locator('#download-button').isVisible();
  },{timeout:100_000}).toBe(true);
}
async function renderedPixels(page){
  return page.locator('#image-preview').evaluate(async image=>{
    await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const context=canvas.getContext('2d');context.drawImage(image,0,0);
    const data=context.getImageData(0,0,canvas.width,canvas.height).data;
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');
    return {width:canvas.width,height:canvas.height,hash};
  });
}
test('Interface loads without errors and fits desktop and mobile',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByRole('heading',{level:1})).toBeVisible();
  await expect(page.locator('#drop-zone')).toBeVisible();await expect(page.locator('#clean-button')).toBeDisabled();
  await page.waitForTimeout(600);
  await page.screenshot({path:'test-results/interface-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/interface-mobile.png',fullPage:true});
  expect(errors).toEqual([]);
});
for(const name of ['png','jpeg','webp','gif']){
  test(`${name}: immediate preview, lossless clean, before/after and delete`,async({page})=>{
    const posts=[];page.on('request',request=>{if(request.method()!=='GET')posts.push(request.url());});
    await page.goto('/');await upload(page,name);
    await expect(page.locator('#image-preview')).toBeVisible();
    const before=await renderedPixels(page);
    await page.locator('#clean-button').click();await waitReady(page);
    await expect(page.locator('#after-tab')).toHaveAttribute('aria-selected','true');
    expect(await renderedPixels(page)).toEqual(before);
    await page.locator('#before-tab').click();expect(await renderedPixels(page)).toEqual(before);
    await page.locator('#after-tab').click();
    const cleanedUrl=await page.locator('#image-preview').getAttribute('src');
    await page.locator('#delete-button').click();
    await expect(page.locator('#drop-zone')).toBeVisible();
    await expect(page.locator('#download-button')).toBeHidden();
    expect(await page.evaluate(async url=>{try{await fetch(url);return false;}catch{return true;}},cleanedUrl)).toBe(true);
    expect(posts).toEqual([],'Files must never be uploaded');
  });
}
test('Download uses the requested filename and contains cleaned image data',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
  await page.goto('/');await upload(page,'png');await page.locator('#clean-button').click();await waitReady(page);
  await page.locator('#output-name').fill('My clean photo');
  const downloadPromise=page.waitForEvent('download');await page.locator('#download-button').click();
  const download=await downloadPromise;expect(download.suggestedFilename()).toBe('My clean photo.png');
  const content=await readFile(await download.path());expect(content.includes(Buffer.from('PRIVATE-'))).toBe(false);
});
test('Native Save As cancellation retains the clean output',async({page})=>{
  await page.addInitScript(()=>{window.showSaveFilePicker=async()=>{throw new DOMException('cancel','AbortError');};});
  await page.goto('/');await upload(page,'png');await page.locator('#clean-button').click();await waitReady(page);
  await page.locator('#download-button').click();await expect(page.locator('#toast')).toContainText('Save cancelled');
  await expect(page.locator('#image-preview')).toBeVisible();await expect(page.locator('#download-button')).toBeVisible();
});
test('Actual browser video engine removes tags and preserves encoded streams',async({page})=>{
  await page.goto('/');await upload(page,'mp4');await expect(page.locator('#video-preview')).toBeVisible();
  await page.locator('#clean-button').click();await waitReady(page);
  await expect(page.locator('#verification-content')).toContainText('Encoded video + audio hashes match');
  await expect(page.locator('#video-preview')).toHaveJSProperty('readyState',4,{timeout:15000});
  await page.locator('#delete-button').click();await expect(page.locator('#drop-zone')).toBeVisible();
});
for(const name of ['bmp','tiff']){
  test(`${name}: lossless PNG export verifies original pixel values`,async({page})=>{
    await page.goto('/');await upload(page,name);await page.locator('#clean-button').click();await waitReady(page);
    await expect(page.locator('#output-extension')).toHaveText('.png');
    await expect(page.locator('#verification-content')).toContainText('Decoded image pixels verified unchanged');
  });
}
