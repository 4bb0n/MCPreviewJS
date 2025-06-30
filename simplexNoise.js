const WORLD_SEED = Math.random().toString(36).substring(2, 10); // Random seed for simplicity, replace with your own logic
function generateFractalNoise2D(simplex, x, y, octaves, persistence, lacunarity, initialFrequency = 0.5, initialAmplitude = 0.5) {
    let total = 0;
    let frequency = initialFrequency;
    let amplitude = initialAmplitude;
    let maxValue = 0;
    for (let i = 0; i < octaves; i++) {
        total += simplex.noise2D(x * frequency, y * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }
    if (maxValue === 0) return 0;
    return total / maxValue; // Normalized to approx [-1, 1]
}
function generateFractalNoise3D(simplex, x, y, z, octaves, persistence, lacunarity, initialFrequency = 0.5, initialAmplitude = 0.5) {
    let total = 0;
    let frequency = initialFrequency;
    let amplitude = initialAmplitude;
    let maxValue = 0;
    for (let i = 0; i < octaves; i++) {
        total += simplex.noise3D(x * frequency, y * frequency, z * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }
    if (maxValue === 0) return 0;
    return total / maxValue; // Normalized to approx [-1, 1]
}
class SimplexNoise {
    /**
     * Creates a new SimplexNoise instance.
     * @param {number|string} [seed] - Optional seed for the random number generator. If not provided, Math.random() is used.
     */
    constructor(seed) {
        // --- Internal Pseudo-Random Number Generator (PRNG) - Mulberry32 ---
        this.random = (function (seedStr) {
            let seed = 1; // Default seed
            if (typeof seedStr === 'string') {
                seed = 0;
                for (let i = 0; i < seedStr.length; i++) {
                    seed = (seed * 31 + seedStr.charCodeAt(i)) | 0; // Use bitwise OR for 32-bit integer
                }
            } else if (typeof seedStr === 'number') {
                seed = seedStr;
            } else if (seed === undefined) {
                seed = Math.floor(Math.random() * 0xFFFFFFFF);
            }
            seed = (seed === 0) ? 1 : seed | 0; // Ensure seed is a non-zero integer

            return function () {
                let t = seed += 0x6D2B79F5;
                t = Math.imul(t ^ t >>> 15, t | 1);
                t ^= t + Math.imul(t ^ t >>> 7, t | 61);
                return ((t ^ t >>> 14) >>> 0) / 4294967296; // Convert to float [0, 1)
            };
        })(seed);

        // --- Permutation Table Initialization ---
        this.p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) { this.p[i] = i; }
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            [this.p[i], this.p[j]] = [this.p[j], this.p[i]]; // Swap
        }
        this.perm = new Uint8Array(512);
        this.permMod12 = new Uint8Array(512);
        for (let i = 0; i < 512; i++) {
            this.perm[i] = this.p[i & 255];
            this.permMod12[i] = this.perm[i] % 12;
        }

        // --- Simplex Noise Constants ---
        this.F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
        this.G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
        this.F3 = 1.0 / 3.0;
        this.G3 = 1.0 / 6.0;
        this.grad3 = [
            [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
            [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
            [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
        ];
        this.grad2 = [
             [1, 0], [-1, 0], [0, 1], [0, -1],
             [1, 1], [-1, 1], [1, -1], [-1, -1]
        ];
    }

    dot(g, x, y) { return g[0] * x + g[1] * y; }
    dot3(g, x, y, z) { return g[0] * x + g[1] * y + g[2] * z; }

    noise2D(xin, yin) {
        let n0, n1, n2;
        const s = (xin + yin) * this.F2;
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        const t = (i + j) * this.G2;
        const X0 = i - t;
        const Y0 = j - t;
        const x0 = xin - X0;
        const y0 = yin - Y0;
        let i1, j1;
        if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
        const x1 = x0 - i1 + this.G2;
        const y1 = y0 - j1 + this.G2;
        const x2 = x0 - 1.0 + 2.0 * this.G2;
        const y2 = y0 - 1.0 + 2.0 * this.G2;
        const ii = i & 255;
        const jj = j & 255;
        const gi0 = this.perm[ii + this.perm[jj]] % this.grad2.length;
        const gi1 = this.perm[ii + i1 + this.perm[jj + j1]] % this.grad2.length;
        const gi2 = this.perm[ii + 1 + this.perm[jj + 1]] % this.grad2.length;
        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 < 0) n0 = 0.0; else { t0 *= t0; n0 = t0 * t0 * this.dot(this.grad2[gi0], x0, y0); }
        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 < 0) n1 = 0.0; else { t1 *= t1; n1 = t1 * t1 * this.dot(this.grad2[gi1], x1, y1); }
        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 < 0) n2 = 0.0; else { t2 *= t2; n2 = t2 * t2 * this.dot(this.grad2[gi2], x2, y2); }
        return 70.0 * (n0 + n1 + n2); // Approx [-1, 1]
    }

    noise3D(xin, yin, zin) {
        let n0, n1, n2, n3;
        const s = (xin + yin + zin) * this.F3;
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        const k = Math.floor(zin + s);
        const t = (i + j + k) * this.G3;
        const X0 = i - t; const Y0 = j - t; const Z0 = k - t;
        const x0 = xin - X0; const y0 = yin - Y0; const z0 = zin - Z0;
        let i1, j1, k1; let i2, j2, k2;
        if (x0 >= y0) {
            if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
            else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
            else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
        } else {
            if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
            else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
            else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
        }
        const x1 = x0 - i1 + this.G3; const y1 = y0 - j1 + this.G3; const z1 = z0 - k1 + this.G3;
        const x2 = x0 - i2 + 2.0 * this.G3; const y2 = y0 - j2 + 2.0 * this.G3; const z2 = z0 - k2 + 2.0 * this.G3;
        const x3 = x0 - 1.0 + 3.0 * this.G3; const y3 = y0 - 1.0 + 3.0 * this.G3; const z3 = z0 - 1.0 + 3.0 * this.G3;
        const ii = i & 255; const jj = j & 255; const kk = k & 255;
        const gi0 = this.permMod12[ii + this.perm[jj + this.perm[kk]]];
        const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1 + this.perm[kk + k1]]];
        const gi2 = this.permMod12[ii + i2 + this.perm[jj + j2 + this.perm[kk + k2]]];
        const gi3 = this.permMod12[ii + 1 + this.perm[jj + 1 + this.perm[kk + 1]]];
        let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
        if (t0 < 0) n0 = 0.0; else { t0 *= t0; n0 = t0 * t0 * this.dot3(this.grad3[gi0], x0, y0, z0); }
        let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
        if (t1 < 0) n1 = 0.0; else { t1 *= t1; n1 = t1 * t1 * this.dot3(this.grad3[gi1], x1, y1, z1); }
        let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
        if (t2 < 0) n2 = 0.0; else { t2 *= t2; n2 = t2 * t2 * this.dot3(this.grad3[gi2], x2, y2, z2); }
        let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
        if (t3 < 0) n3 = 0.0; else { t3 *= t3; n3 = t3 * t3 * this.dot3(this.grad3[gi3], x3, y3, z3); }
        return 32.0 * (n0 + n1 + n2 + n3); // Approx [-1, 1]
    }
}
// --- Add this to chunkWorker.js (outside any class, or as a static method if preferred) ---

/**
 * Creates a Mulberry32 pseudo-random number generator.
 * @param {number} seed - The initial seed. Must be an integer.
 * @returns {function} A function that returns a pseudo-random float between 0 (inclusive) and 1 (exclusive).
 */
function createMulberry32(seed) {
    seed = seed | 0; // Ensure it's a 32-bit integer
    seed = (seed === 0) ? 1 : seed; // Ensure seed is non-zero
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

/**
 * Simple hashing function to combine numbers into a single seed.
 * Not cryptographically secure, just for mixing inputs for PRNG.
 * @param  {...number} args - Numbers to hash.
 * @returns {number} A 32-bit integer hash.
 */
function simpleHash(...args) {
    let hash = 17; // Initial prime
    for (const arg of args) {
        hash = (hash * 31 + (arg | 0)) | 0; // Multiply by prime, add arg, ensure 32-bit int
    }
    return hash;
}

// We'll use the main WORLD_SEED from your SimplexNoise instance
// const WORLD_SEED = "012345!"; // Already defined
// Let's convert the string world seed to a number once for hashing
let numericWorldSeed = 0;
for (let i = 0; i < WORLD_SEED.length; i++) {
    numericWorldSeed = (numericWorldSeed * 31 + WORLD_SEED.charCodeAt(i)) | 0;
}
if (numericWorldSeed === 0) numericWorldSeed = 1; // Ensure non-zero for hashing

module.exports = {
    SimplexNoise,
    generateFractalNoise2D,
    generateFractalNoise3D,
    createMulberry32,
    simpleHash,
    WORLD_SEED,
    numericWorldSeed
};