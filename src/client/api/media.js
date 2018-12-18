import SketchfabZipWorker from "./sketchfab-zip.worker.js";

const resolveUrlCache = new Map();

async function resolveUrl(url, index) {
  const cacheKey = `${url}|${index}`;
  if (resolveUrlCache.has(cacheKey)) return resolveUrlCache.get(cacheKey);

  const response = await fetch("/api/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media: { url, index } })
  });

  if (!response.ok) {
    const message = `Error resolving url "${url}":`;
    try {
      const body = await response.text();
      throw new Error(message + " " + body);
    } catch (e) {
      throw new Error(message + " " + response.statusText);
    }
  }

  const resolved = await response.json();
  resolveUrlCache.set(cacheKey, resolved);
  return resolved;
}

function proxiedUrlFor(url) {
  const proxiedUrl = new URL(`/api/cors-proxy`, window.location);
  proxiedUrl.searchParams.set("url", url);
  return proxiedUrl.href;
}

function getFilesFromSketchfabZip(src) {
  return new Promise((resolve, reject) => {
    const worker = new SketchfabZipWorker();
    worker.onmessage = e => {
      const [success, fileMapOrError] = e.data;
      (success ? resolve : reject)(fileMapOrError);
    };
    worker.postMessage(src);
  });
}

function fetchContentType(accessibleUrl) {
  return fetch(accessibleUrl, { method: "HEAD" }).then(r => r.headers.get("content-type"));
}

const CommonKnownContentTypes = {
  gltf: "model/gltf",
  glb: "model/gltf-binary",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
  mp4: "video/mp4",
  mp3: "audio/mpeg"
};

function guessContentType(url) {
  const extension = new URL(url).pathname.split(".").pop();
  return CommonKnownContentTypes[extension];
}

export async function getContentType(url) {
  const result = await resolveUrl(url);
  const canonicalUrl = result.origin;
  const accessibleUrl = proxiedUrlFor(canonicalUrl);

  return (
    (result.meta && result.meta.expected_content_type) ||
    guessContentType(canonicalUrl) ||
    (await fetchContentType(accessibleUrl))
  );
}

export async function resolveMedia(src, index) {
  const href = new URL(src, window.location).href;
  const result = await resolveUrl(href);
  const canonicalUrl = result.origin;
  const accessibleUrl = proxiedUrlFor(canonicalUrl, index);

  const contentType =
    (result.meta && result.meta.expected_content_type) ||
    guessContentType(canonicalUrl) ||
    (await fetchContentType(accessibleUrl));

  if (contentType === "model/gltf+zip") {
    // TODO: Sketchfab object urls should be revoked after they are loaded by the glTF loader.
    const files = await getFilesFromSketchfabZip(accessibleUrl);
    return { canonicalUrl, accessibleUrl: files["scene.gtlf"], contentType, files };
  }

  return { canonicalUrl, accessibleUrl, contentType };
}