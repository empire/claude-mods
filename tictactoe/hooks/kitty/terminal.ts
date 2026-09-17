/**
 * The kitty graphics protocol, the parts this board uses: images uploaded
 * straight to the terminal, and shown through Unicode placeholders.
 *
 * Claude Code's renderer never passes an escape sequence through, so the
 * hooks module uploads each frame by piping it to a small helper process
 * that writes it to /dev/tty. The image is uploaded as a virtual placement
 * (`U=1`); it appears wherever the board draws placeholder cells in the
 * image's id color. Those cells go through the renderer like any other text,
 * so the picture moves with the layout and goes away with the text.
 *
 * https://sw.kovidgoyal.net/kitty/graphics-protocol/#unicode-placeholders
 */

/** The placeholder character kitty paints an image cell over. */
export const PLACEHOLDER = '\u{10EEEE}'

/**
 * Row and column diacritics, the first 96 of kitty's rowcolumn-diacritics.txt,
 * in order: the nth names row or column n.
 */
const DIACRITICS = [
  0x0305, 0x030d, 0x030e, 0x0310, 0x0312, 0x033d, 0x033e, 0x033f, 0x0346, 0x034a,
  0x034b, 0x034c, 0x0350, 0x0351, 0x0352, 0x0357, 0x035b, 0x0363, 0x0364, 0x0365,
  0x0366, 0x0367, 0x0368, 0x0369, 0x036a, 0x036b, 0x036c, 0x036d, 0x036e, 0x036f,
  0x0483, 0x0484, 0x0485, 0x0486, 0x0487, 0x0592, 0x0593, 0x0594, 0x0595, 0x0597,
  0x0598, 0x0599, 0x059c, 0x059d, 0x059e, 0x059f, 0x05a0, 0x05a1, 0x05a8, 0x05a9,
  0x05ab, 0x05ac, 0x05af, 0x05c4, 0x0610, 0x0611, 0x0612, 0x0613, 0x0614, 0x0615,
  0x0616, 0x0617, 0x0657, 0x0658, 0x0659, 0x065a, 0x065b, 0x065d, 0x065e, 0x06d6,
  0x06d7, 0x06d8, 0x06d9, 0x06da, 0x06db, 0x06dc, 0x06df, 0x06e0, 0x06e1, 0x06e2,
  0x06e4, 0x06e7, 0x06e8, 0x06eb, 0x06ec, 0x0730, 0x0732, 0x0733, 0x0735, 0x0736,
  0x073a, 0x073d, 0x073f, 0x0740, 0x0741, 0x0743,
]

/** The most rows or columns a placeholder cell can name. */
export const MAX_CELLS = DIACRITICS.length

/**
 * One placeholder cell naming its row and column outright, so it still maps
 * to the right part of the image when text (a menu) covers its neighbours.
 */
export function placeholderCell(row: number, column: number): string {
  const diacritic = (n: number) => String.fromCodePoint(DIACRITICS[n] ?? 0x0305)

  return `${PLACEHOLDER}${diacritic(row)}${diacritic(column)}`
}

/** The foreground color whose 24-bit value is the image id. */
export const idColorOf = (id: number) => `#${id.toString(16).padStart(6, '0')}`

/** A fresh image id whose color has no zero byte, unlikely to meet another's. */
export function newImageId(random: () => number = Math.random): number {
  const byte = () => 0x20 + Math.floor(random() * 0xd0)

  return (byte() << 16) | (byte() << 8) | byte()
}

/** Reads the terminal's size in cells and pixels: `rows cols xpixel ypixel`. */
export const PROBE_PY = `
import fcntl, struct, termios
with open('/dev/tty', 'rb') as t:
    print(*struct.unpack('HHHH', fcntl.ioctl(t, termios.TIOCGWINSZ, b'\\0' * 8)))
`

/**
 * Reads base64 RGBA on stdin, compresses it, and writes the upload to the
 * terminal: argv is width, height, image id, columns, rows. \`q=2\` keeps the
 * terminal from answering, so nothing lands in Claude Code's input.
 */
export const UPLOAD_PY = `
import base64, sys, zlib
w, h, i, c, r = map(int, sys.argv[1:6])
data = base64.b64encode(zlib.compress(base64.b64decode(sys.stdin.buffer.read()), 6))
out = bytearray()
for k in range(0, len(data), 4096):
    more = 1 if k + 4096 < len(data) else 0
    head = b'a=T,U=1,i=%d,c=%d,r=%d,f=32,s=%d,v=%d,o=z,q=2,m=%d' % (i, c, r, w, h, more) if k == 0 else b'm=%d' % more
    out += b'\\x1b_G' + head + b';' + data[k:k + 4096] + b'\\x1b\\\\'
with open('/dev/tty', 'wb', buffering=0) as t:
    t.write(bytes(out))
`

/** Frees the image and its placements. */
export const deleteImage = (id: number) => `\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`

/** Standard base64 of bytes, in slices so no call gets too many arguments. */
export function base64Of(bytes: Uint8Array): string {
  let binary = ''

  for (let k = 0; k < bytes.length; k += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(k, k + 0x8000))
  }

  return btoa(binary)
}
