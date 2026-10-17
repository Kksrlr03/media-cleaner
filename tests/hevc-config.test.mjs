import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanHevcConfig} from '../src/hevc-config.mjs';
const box=(name,payload)=>{const b=Buffer.alloc(8+payload.length);b.writeUInt32BE(b.length);b.write(name,4);payload.copy(b,8);return b;};
function source(){
 const header=Buffer.alloc(23);header[0]=1;header[22]=2;
 const array=(kind,data)=>Buffer.from([kind,0,1,0,data.length+2,kind<<1,1,...data]);
 const record=Buffer.concat([header,array(33,[1,2,3]),array(39,[83,69,67,82,69,84])]);
 const entry=box('hvc1',Buffer.concat([Buffer.alloc(78),box('hvcC',record)]));
 let root=box('stsd',Buffer.concat([Buffer.alloc(8),entry]));
 for(const kind of ['stbl','minf','mdia','trak','moov'])root=box(kind,root);
 return Buffer.concat([root,box('mdat',Buffer.from('PICTURE-DATA'))]);
}
test('HEVC configuration cleaning removes SEI payload without shifting picture data',()=>{
 const input=source(),original=input.slice();const result=cleanHevcConfig(input);
 assert.equal(result.removed,1);assert.equal(result.bytes.length,input.length);
 assert.deepEqual(input,original);assert.equal(Buffer.from(result.bytes).includes(Buffer.from('SECRET')),false);
 assert.equal(Buffer.from(result.bytes).subarray(-12).toString(),'PICTURE-DATA');
 assert.equal(cleanHevcConfig(result.bytes).removed,0);
});
