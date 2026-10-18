import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appleMapsUrl} from '../web/map-links.mjs';

test('Unnamed coordinates never escape automatically; place search is clearly unverified',()=>{
 const target=appleMapsUrl({title:'Fictional Harbour',latitude:null,longitude:null});
 const url=new URL(target.href);
 assert.equal(url.origin,'https://maps.apple.com');
 assert.equal(url.pathname,'/search');
 assert.equal(url.searchParams.get('query'),'Fictional Harbour');
 assert.equal(target.verified_coordinates,false);
 assert.equal(url.searchParams.has('coordinate'),false);
});

test('Saved valid coordinates open the selected point without claiming a supplier route',()=>{
 const target=appleMapsUrl({title:'Fictional Museum',latitude:43.6532,longitude:-79.3832,
   status:'possible',bookings:[{status:'confirmed'}]});
 const url=new URL(target.href);
 assert.equal(url.pathname,'/place');
 assert.equal(url.searchParams.get('coordinate'),'43.6532,-79.3832');
 assert.equal(url.searchParams.get('name'),'Fictional Museum');
 assert.equal(target.verified_coordinates,true);
 assert.equal(url.searchParams.has('directions'),false);
 assert.equal(url.searchParams.has('booking'),false);
});

test('Unverified malformed coordinates fall back to an encoded search, never a forged pin',()=>{
 for(const coordinates of [{latitude:92,longitude:0},{latitude:43,longitude:200},
    {latitude:'43',longitude:-79},{latitude:12,longitude:null}]){
   const result=appleMapsUrl({title:'Vale & Bay? x=1',...coordinates});
   assert.equal(result.verified_coordinates,false);
   assert.equal(new URL(result.href).searchParams.get('query'),'Vale & Bay? x=1');
   assert.equal(new URL(result.href).pathname,'/search');
 }
 assert.throws(()=>appleMapsUrl({title:' '}),/named place/);
});
