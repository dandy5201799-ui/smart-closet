/** 将 data URL 转为 File，供 resizeImage 等复用 */
export async function dataUrlToFile(dataUrl: string, filename = "image.jpg"): Promise<File> {
  const r = await fetch(dataUrl);
  const blob = await r.blob();
  return new File([blob], filename, { type: blob.type || "image/jpeg" });
}

/**
 * Resizes an image to a maximum dimension to optimize performance.
 */
export const resizeImage = (file: File, maxDimension: number = 800): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxDimension) {
            height *= maxDimension / width;
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width *= maxDimension / height;
            height = maxDimension;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error("Canvas Error"));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
};

/**
 * Downscales a base64 image to a very small size for AI reference.
 */
export const shrinkBase64 = (base64: string, maxDim: number = 256): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width;
      let h = img.height;
      if (w > h) {
        if (w > maxDim) { h *= maxDim / w; w = maxDim; }
      } else {
        if (h > maxDim) { w *= maxDim / h; h = maxDim; }
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.7)); // Use JPEG for smaller payload
    };
    img.src = base64;
  });
};

/**
 * Flood Fill algorithm for non-AI background removal.
 * Clears connected pixels similar to the clicked point.
 */
export const floodFillRemove = (
  base64: string,
  startX: number,
  startY: number,
  tolerance: number = 30
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject();
      ctx.drawImage(img, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const width = imageData.width;
      const height = imageData.height;

      const getPos = (x: number, y: number) => (y * width + x) * 4;
      const startPos = getPos(Math.floor(startX), Math.floor(startY));
      const targetR = data[startPos];
      const targetG = data[startPos + 1];
      const targetB = data[startPos + 2];
      const targetA = data[startPos + 3];

      // Don't fill if we click on something already transparent
      if (targetA === 0) {
        resolve(base64);
        return;
      }

      const visited = new Uint8Array(width * height);
      const stack: [number, number][] = [[Math.floor(startX), Math.floor(startY)]];

      while (stack.length > 0) {
        const [x, y] = stack.pop()!;
        const idx = y * width + x;
        
        if (x < 0 || x >= width || y < 0 || y >= height || visited[idx]) continue;

        const pos = idx * 4;
        const r = data[pos];
        const g = data[pos + 1];
        const b = data[pos + 2];
        const a = data[pos + 3];

        if (a === 0) {
          visited[idx] = 1;
          continue;
        }

        const dist = Math.sqrt(
          Math.pow(r - targetR, 2) + Math.pow(g - targetG, 2) + Math.pow(b - targetB, 2)
        );

        if (dist <= tolerance) {
          data[pos + 3] = 0; // Transparent
          visited[idx] = 1;
          stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = base64;
  });
};
