/**
 * What the image board needs from the terminal beyond the engine's `Image`
 * element: the size of a cell in pixels, so the picture is painted to fill
 * its cell box exactly and clicks land on the right square, and the base64
 * the element's `source` takes.
 *
 * The engine draws the `Image` itself (the kitty graphics protocol in kitty
 * and Ghostty, its `alt` elsewhere), so nothing here writes to the terminal.
 */

/** Reads the terminal's size in cells and pixels: `rows cols xpixel ypixel`. */
export const PROBE_PY = `
import fcntl, struct, termios
with open('/dev/tty', 'rb') as t:
    print(*struct.unpack('HHHH', fcntl.ioctl(t, termios.TIOCGWINSZ, b'\\0' * 8)))
`

/** Standard base64 of bytes, in slices so no call gets too many arguments. */
export function base64Of(bytes: Uint8Array): string {
  let binary = ''

  for (let k = 0; k < bytes.length; k += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(k, k + 0x8000))
  }

  return btoa(binary)
}
