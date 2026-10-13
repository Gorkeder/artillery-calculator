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

  function distToSegment(p, a, b) {
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var len2 = dx * dx + dy * dy;
    var t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var ex = a[0] + t * dx - p[0];
    var ey = a[1] + t * dy - p[1];
    return Math.sqrt(ex * ex + ey * ey);
  }

  // Douglas–Peucker over [x, y] pairs, iterative so a 5000-point stroke cannot overflow the stack.
  function simplify(points, epsilon) {
    var n = points.length;
    if (n <= 2) return points.slice();
    var keep = new Array(n);
    keep[0] = true;
    keep[n - 1] = true;
    var stack = [[0, n - 1]];
    while (stack.length) {
      var seg = stack.pop();
      var first = seg[0];
      var last = seg[1];
      var maxD = 0;
      var idx = -1;
      for (var i = first + 1; i < last; i++) {
        var d = distToSegment(points[i], points[first], points[last]);
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (idx !== -1 && maxD > epsilon) {
        keep[idx] = true;
        stack.push([first, idx], [idx, last]);
      }
    }
    return points.filter(function (_, i) { return keep[i]; });
  }

  return {
    toLatLng: toLatLng,
    simplify: simplify,
    fromLatLng: fromLatLng,
    pointsToLatLngs: pointsToLatLngs,
    latLngsToPoints: latLngsToPoints,
    featureStyle: featureStyle,
  };
});
