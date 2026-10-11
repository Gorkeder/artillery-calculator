(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MapGeo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clamp01(n) {
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  // Stored coordinates are fractions of the image (x right, y down, 0..1).
  // Leaflet CRS.Simple has y growing upwards, with image bounds [[0,0],[height,width]].
  function toLatLng(p, size) {
    return [size.height * (1 - p.y), size.width * p.x];
  }

  function fromLatLng(ll, size) {
    var lat = Array.isArray(ll) ? ll[0] : ll.lat;
    var lng = Array.isArray(ll) ? ll[1] : ll.lng;
    return { x: clamp01(lng / size.width), y: clamp01(1 - lat / size.height) };
  }

  function pointsToLatLngs(points, size) {
    return points.map(function (p) {
      return toLatLng({ x: p[0], y: p[1] }, size);
    });
  }

  function latLngsToPoints(latlngs, size) {
    return latlngs.map(function (ll) {
      var p = fromLatLng(ll, size);
      return [p.x, p.y];
    });
  }

  function featureStyle(feature, category) {
    var color = feature.color || category.color;
    var opacity = feature.opacity === null || feature.opacity === undefined ? 0.25 : feature.opacity;
    return { color: color, fillColor: color, fillOpacity: opacity, weight: 2 };
  }

  return {
    toLatLng: toLatLng,
    fromLatLng: fromLatLng,
    pointsToLatLngs: pointsToLatLngs,
    latLngsToPoints: latLngsToPoints,
    featureStyle: featureStyle,
  };
});
