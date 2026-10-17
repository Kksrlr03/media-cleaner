import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cleanImage, inspectFormat, join } from '../src/image-cleaner.mjs';
const fixtures=JSON.parse(await readFile(new URL('./fixtures.json',import.meta.url),'utf8'));
const bytes=(name)=>new Uint8Array(Buffer.from(fixtures[name],'base64'));
for(const name of ['png','jpeg','webp','gif']){
  test(`${name}: remove private fields, retain encoded data and remain idempotent`,async()=>{
    const source=bytes(name),original=source.slice(),result=await cleanImage(source);
    assert.deepEqual(source,original,'Input must not be mutated');
    assert.equal(result.report.encodedImageDataIdentical,true);
    assert.ok(result.report.removedCount>0);
    assert.ok(!Buffer.from(result.bytes).toString('latin1').includes('PRIVATE-'),'Descriptive metadata remains');
    const second=await cleanImage(result.bytes);
    assert.deepEqual(second.bytes,result.bytes);
    assert.equal(second.report.imageDataSha256,result.report.imageDataSha256);
    assert.equal(result.report.inputBytes,source.length);
  });
}
test('JPEG preserves color profile and orientation without original EXIF fields',async()=>{
  const result=await cleanImage(bytes('jpeg'));
  assert.ok(result.report.preserved.includes('ICC color profile'));
  assert.ok(result.report.preserved.includes('Display orientation'));
});
test('PNG preserves alpha, ICC and animation structure',async()=>{
  const result=await cleanImage(bytes('png'));
  assert.ok(result.report.preserved.some(x=>x.includes('iCCP')));
  assert.equal(inspectFormat(result.bytes),'png');
});
test('GIF keeps the animated payload and loop timing',async()=>{
  const result=await cleanImage(bytes('gif'));
  assert.ok(result.report.preserved.includes('Animation timing and loop'));
  assert.ok(Buffer.from(result.bytes).includes(Buffer.from('NETSCAPE2.0')));
});
test('Trailing payloads are removed without changing image data',async()=>{
  for(const name of ['png','jpeg','webp','gif']){
    const original=await cleanImage(bytes(name));
    const result=await cleanImage(join([bytes(name),new TextEncoder().encode('PRIVATE-APPENDED-DATA')]));
    assert.deepEqual(result.bytes,original.bytes);
    assert.ok(result.report.removed.includes('Trailing file data'));
  }
});
test('Invalid PNG checksum and truncated files fail safely',async()=>{
  const png=bytes('png');png[30]^=1;
  await assert.rejects(cleanImage(png),/checksum/);
  for(const name of ['png','jpeg','webp','gif'])await assert.rejects(cleanImage(bytes(name).subarray(0,20)));
});
test('HTML and unrecognized file data are rejected',async()=>{
  await assert.rejects(cleanImage(new TextEncoder().encode('<svg onload="alert(1)"></svg>')),/Choose a PNG/);
});
