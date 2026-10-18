// External map handoff only on an explicit member tap. No maps service,
// geocoding, device location, telemetry or booking request runs in Justelle.
export function appleMapsUrl(place){
  if(!place||typeof place.title!=='string'||!place.title.trim())
    throw Error('Choose a named place before opening Maps');
  const latitude=place.latitude,longitude=place.longitude;
  const coordinates=typeof latitude==='number'&&typeof longitude==='number'&&
    Number.isFinite(latitude)&&Number.isFinite(longitude)&&
    latitude>=-90&&latitude<=90&&longitude>=-180&&longitude<=180;
  const url=new URL(coordinates?'https://maps.apple.com/place':'https://maps.apple.com/search');
  if(coordinates){
    url.searchParams.set('coordinate',latitude+','+longitude);
    url.searchParams.set('name',place.title);
  }else url.searchParams.set('query',place.title);
  return {href:url.toString(),verified_coordinates:coordinates};
}
