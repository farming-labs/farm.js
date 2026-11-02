// The React Native screen for /map on every OS that does not override it (module id app/map).
// Farm records it in farm-routes.json as screen "native"; no native engine builds it yet, so the
// Android shell shows a placeholder. Web builds never read this file: it is not a route, not in
// the generated route types, and not in any web bundle.
export default function MapScreen() {
  return null;
}
