// Single sanitizer for every surface that injects model/panel SVG into a live
// DOM. It lives in eterna-react so DiagramBlock (which renders the tool's raw
// `svg` input) applies the exact same stripping as the page modal and the tab
// fallback here — three surfaces, one policy.
export { sanitizeSvgMarkup } from "@eterna/react/lib/sanitize-svg";
