export const META_PIXEL_SRC = "https://connect.facebook.net/en_US/fbevents.js";

function envPixelId() {
  return (
    typeof process !== "undefined"
      ? process.env.META_PIXEL_ID ?? process.env.FACEBOOK_PIXEL_ID ?? ""
      : ""
  ).trim();
}

export function metaHeadScript(pixelId = envPixelId()) {
  const id = pixelId.trim();
  if (!id) return "";
  return `(function(){if(location.pathname.toLowerCase().indexOf("/admin")===0)return;!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','${META_PIXEL_SRC}');fbq('init','${id}');fbq('track','PageView');})();`;
}
