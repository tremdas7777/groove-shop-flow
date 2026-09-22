export const UTMIFY_PIXEL_ID = "6ab29af50933bc9cf905f865";
export const UTMIFY_PIXEL_SRC = "https://cdn.utmify.com.br/scripts/pixel/pixel.js";
export const UTMIFY_UTMS_SRC = "https://cdn.utmify.com.br/scripts/utms/latest.js";

function addScript(src: string, attrs: Record<string, string> = {}) {
  if (document.querySelector(`script[src="${src}"]`)) return;
  const script = document.createElement("script");
  script.src = src;
  script.async = true;
  script.defer = true;
  for (const [key, value] of Object.entries(attrs)) script.setAttribute(key, value);
  (document.head || document.documentElement).appendChild(script);
}

export function injectUtmifyPixel(pixelId = UTMIFY_PIXEL_ID) {
  if (typeof window === "undefined") return;
  if (window.location.pathname.toLowerCase().startsWith("/admin")) return;
  window.pixelId = pixelId.trim() || UTMIFY_PIXEL_ID;
  addScript(UTMIFY_UTMS_SRC, {
    "data-utmify-prevent-xcod-sck": "",
    "data-utmify-prevent-subids": "",
  });
  addScript(UTMIFY_PIXEL_SRC);
}

export const utmifyHeadScript = `(function(){if(location.pathname.toLowerCase().indexOf("/admin")===0)return;window.pixelId="${UTMIFY_PIXEL_ID}";function a(s,t){if(document.querySelector('script[src="'+s+'"]'))return;var e=document.createElement("script");e.src=s;e.async=true;e.defer=true;if(t){for(var n in t)e.setAttribute(n,t[n]);}(document.head||document.documentElement).appendChild(e);}a("${UTMIFY_UTMS_SRC}",{"data-utmify-prevent-xcod-sck":"","data-utmify-prevent-subids":""});a("${UTMIFY_PIXEL_SRC}");})();`;
