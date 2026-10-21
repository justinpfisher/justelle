// A small purely synthetic PNG for hosted vision qualification. No fixture
// photo, personal media, browser canvas, image package or external service.
import {deflateSync} from 'node:zlib';
const WIDTH=24,HEIGHT=24;
const colours={red:[255,0,0],blue:[0,0,255]};
function crc32(data){
  let crc=0xffffffff;
  for(const byte of data){
    crc^=byte;
    for(let i=0;i<8;i++)crc=(crc>>>1)^(crc&1?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
function chunk(type,bytes){
  const name=Buffer.from(type,'ascii');
  const len=Buffer.alloc(4);len.writeUInt32BE(bytes.length);
  const checksum=Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name,bytes])));
  return Buffer.concat([len,name,bytes,checksum]);
}
export function syntheticVisionPng(colour){
  const rgb=colours[colour];
  if(!rgb)throw Error('Only fictional red or blue vision fixtures are allowed');
  const header=Buffer.alloc(13);
  header.writeUInt32BE(WIDTH,0);header.writeUInt32BE(HEIGHT,4);
  header[8]=8;header[9]=2; // 8-bit RGB, no colour management or alpha
  const raw=Buffer.alloc(HEIGHT*(1+WIDTH*3));
  for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){
    const at=y*(1+WIDTH*3)+1+x*3;
    for(let channel=0;channel<3;channel++)raw[at+channel]=rgb[channel];
  }
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))
  ]);
}
// Require the model to distinguish the images from their pixels rather than
// only return a generic clarification. The exact requested colour is not
// included in the source message and neither image has a revealing name.
export function visionColourAnswer(reply,expected){
  const words=String(reply||'').toLowerCase().match(/\b(red|blue)\b/g)||[];
  return ['red','blue'].includes(expected)&&words.length===1&&words[0]===expected;
}
