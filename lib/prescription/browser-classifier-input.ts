// Match the two-pass, 8-bit bilinear resize in the classifier's Pillow preprocessing.
// Canvas scaling can choose a different filter on each platform.
const WEIGHT_SCALE = 2 ** 22;
export const MODEL_SIDE = 224;

function bilinearWeights(inputLength: number, outputLength: number) {
  const scale = inputLength / outputLength;
  const radius = Math.max(1, scale);
  return Array.from({ length: outputLength }, (_, position) => {
    const center = (position + 0.5) * scale;
    const first = Math.max(0, Math.floor(center - radius + 0.5));
    const end = Math.min(inputLength, Math.floor(center + radius + 0.5));
    const weights = Array.from({ length: end - first }, (_, index) =>
      Math.max(0, 1 - Math.abs((first + index + 0.5 - center) / radius)));
    const total = weights.reduce((sum, value) => sum + value, 0);
    return { first, weights: weights.map(value => Math.round(value / total * WEIGHT_SCALE)) };
  });
}

// Transposing the output lets both passes use the same row filter. Two transposes
// restore the original orientation. Each pass rounds to bytes, as it does in training.
function resizeRows(
  pixels: Uint8ClampedArray | Uint8Array, width: number, height: number,
  channels: number, outputWidth: number,
) {
  const filters = bilinearWeights(width, outputWidth);
  const result = new Uint8ClampedArray(outputWidth * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < outputWidth; x++) {
      const { first, weights } = filters[x];
      for (let channel = 0; channel < 3; channel++) {
        let sum = WEIGHT_SCALE / 2;
        let input = (y * width + first) * channels + channel;
        for (const weight of weights) {
          sum += pixels[input] * weight;
          input += channels;
        }
        result[(x * height + y) * 3 + channel] = Math.floor(sum / WEIGHT_SCALE);
      }
    }
  }
  return result;
}

const MEAN = Float32Array.of(0.485, 0.456, 0.406);
const STD = Float32Array.of(0.229, 0.224, 0.225);

export function prepareClassifierInput({ data, width, height }: ImageData): Float32Array<ArrayBuffer> {
  const scale = MODEL_SIDE / Math.max(width, height);
  const resizedWidth = Math.max(1, Math.round(width * scale));
  const resizedHeight = Math.max(1, Math.round(height * scale));
  const rows = resizeRows(data, width, height, 4, resizedWidth);
  const resized = resizeRows(rows, height, resizedWidth, 3, resizedHeight);
  const left = Math.floor((MODEL_SIDE - resizedWidth) / 2);
  const top = Math.floor((MODEL_SIDE - resizedHeight) / 2);
  const plane = MODEL_SIDE * MODEL_SIDE;
  const tensor = new Float32Array(3 * plane);
  for (let channel = 0; channel < 3; channel++) {
    const normalized = Float32Array.from({ length: 256 }, (_, byte) =>
      Math.fround(Math.fround(byte / 255) - MEAN[channel]) / STD[channel]);
    const offset = channel * plane;
    tensor.fill(normalized[255], offset, offset + plane);
    for (let y = 0; y < resizedHeight; y++) {
      for (let x = 0; x < resizedWidth; x++) {
        const byte = resized[(y * resizedWidth + x) * 3 + channel];
        tensor[offset + (top + y) * MODEL_SIDE + left + x] = normalized[byte];
      }
    }
  }
  return tensor;
}
