
const fs = require("fs").promises;
const path = require("path");
const {
  SimplexNoise,
  generateFractalNoise2D,
  generateFractalNoise3D,
  createMulberry32,
  simpleHash,
} = require("./simplexNoise.js");

const ChunkState = {
  Unknown: 0,
  LoadingData: 1,
  DataLoaded: 2,
  Meshing: 3,
  Active: 4,
  Inactive: 5,
  NeedsRemesh: 6,
};
const { parentPort, workerData } = require("worker_threads");
const THREE = require("three");
const CHUNK_SIZE = 16;
const faceGeometries = {
  right: new THREE.PlaneGeometry(1, 1)
    .rotateY(Math.PI / 2)
    .translate(0.5, 0, 0),
  left: new THREE.PlaneGeometry(1, 1)
    .rotateY(-Math.PI / 2)
    .translate(-0.5, 0, 0),
  top: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.5, 0),
  bottom: new THREE.PlaneGeometry(1, 1)
    .rotateX(Math.PI / 2)
    .translate(0, -0.5, 0),
  front: new THREE.PlaneGeometry(1, 1).translate(0, 0, 0.5),
  back: new THREE.PlaneGeometry(1, 1).rotateY(Math.PI).translate(0, 0, -0.5),
};

let chunks = new Map();
let world = {}
const worldDirectory = path.join(__dirname, "world");

// --- All helper functions from index.js go here ---
// (getBlock, hasBlock, hasSolidBlock, getBlockKey, worldToChunkCoords, chunkToWorldCoords, etc.)
// I have included them all for completeness.

function getBlockKey(x, y, z) {
  return `${Math.floor(x)}_${Math.floor(y)}_${Math.floor(z)}`;
}

function removeChunkBlocksFromWorkerMemory(chunkX, chunkZ) {
  if (Object.keys(world).length === 0) return; // Don't do anything if world is empty

  const { wx: chunkStartX, wz: chunkStartZ } = chunkToWorldCoords(chunkX, chunkZ);

  // Use a wide Y-range to ensure all potential blocks are cleared
  const MIN_Y = -100;
  const MAX_Y = 200;

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let y = MIN_Y; y <= MAX_Y; y++) {
        const blockKey = getBlockKey(chunkStartX + x, y, chunkStartZ + z);
        // This is safe; deleting a non-existent key does nothing.
        delete world[blockKey];
      }
    }
  }
  // Optional: Log the size to confirm it's shrinking.
  // console.log(`[Worker] Cleaned blocks for ${chunkX}_${chunkZ}. Worker world size: ${Object.keys(world).length}`);
}

function chunkToWorldCoords(chunkX, chunkZ) {
  return { wx: chunkX * CHUNK_SIZE, wz: chunkZ * CHUNK_SIZE };
}

function getBlock(x, y, z) {
  const key = getBlockKey(x, y, z);
  const data = world[key];
  return data
    ? { ...data, id: key, x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) }
    : undefined;
}

function hasSolidBlock(x, y, z) {
  const key = getBlockKey(x, y, z);
  return world[key]?.solid === true;
}

function hasBlock(x, y, z) {
  return world[getBlockKey(x, y, z)] !== undefined;
}

function internalAddBlock(
  worldX,
  worldY,
  worldZ,
  blockType,
  overwrite = false
) {
  const blockKey = getBlockKey(worldX, worldY, worldZ);
  if (!overwrite && world[blockKey]) return;
  const isSolid = [
    "grass",
    "log",
    "dirt",
    "stone",
    "plank",
    "craftingtable",
    "leaves",
    "cobblestone",
    "coal_ore",
    "oxidized_iron_ore",
    "bedrock",
    "furnace",
    "landmine",
  ].includes(blockType);
  world[blockKey] = { type: blockType, solid: isSolid };
}

// --- BIOME AND TERRAIN GENERATION LOGIC (UNCHANGED, JUST MOVED) ---
const simplex = new SimplexNoise(workerData.WORLD_SEED);
const numericWorldSeed = workerData.numericWorldSeed;
const FRACTAL_OCTAVES = 6;
const FRACTAL_PERSISTENCE = 0.5;
const FRACTAL_LACUNARITY = 2.0;
const BiomeType = { Plains: 0, Forest: 1, Mountain: 2, River: 3 };
const biomeParameters = {
  [BiomeType.Plains]: {
    name: "Plains",
    baseHeight: 3,
    terrainAmplitude: 3,
    terrainScale: 0.06,
    terrainOctaves: 3,
    terrainPersistence: 0.45,
    hillAmplitude: 15,
    hillScale: 0.008,
    hillOctaves: 4,
    hillPersistence: 0.5,
    treeDensity: 0.005,
    treeHeightMin: 3,
    treeHeightMax: 5,
    surfaceBlock: "grass",
    underSurfaceBlock: "dirt",
    dirtDepth: 3,
    stoneLevelModifier: -10,
    plainsForestPatchChance: 0.03,
    plainsForestPatchDensity: 0.05,
  },
  [BiomeType.Forest]: {
    name: "Forest",
    baseHeight: 3,
    terrainAmplitude: 20,
    terrainScale: 0.03,
    treeDensity: 0.04,
    treeHeightMin: 4,
    treeHeightMax: 7,
    surfaceBlock: "grass",
    underSurfaceBlock: "dirt",
    dirtDepth: 4,
    stoneLevelModifier: -8,
    terrainOctaves: 1,
  },
  [BiomeType.Mountain]: {
    name: "Mountain",
    baseHeight: 20,
    terrainAmplitude: 10,
    terrainScale: 0.02,
    treeDensity: 0.005,
    treeHeightMin: 3,
    treeHeightMax: 5,
    surfaceBlock: "grass",
    underSurfaceBlock: "stone",
    dirtDepth: 3,
    stoneLevelModifier: 0,
    snowLevel: 55,
    terrainOctaves: 2,
    terrainPersistence: 0.55,
    terrainLacunarity: 2.1,
    roughnessAmplitude: 1,
  },
  [BiomeType.River]: {
    name: "River",
    baseHeight: 1,
    terrainAmplitude: 3,
    terrainScale: 0.04,
    treeDensity: 0.003,
    treeHeightMin: 3,
    treeHeightMax: 5,
    surfaceBlock: "water",
    underSurfaceBlock: "dirt",
    dirtDepth: 3,
    stoneLevelModifier: -10,
    plainsForestPatchChance: 0.03,
    plainsForestPatchDensity: 0.05,
    terrainOctaves: 0.2,
    terrainPersistence: 0.45,
  },
};
const biomeNoiseScale = 0.0025;
const biomeOctaves = 4;
const biomePersistence = 0.5;
const biomeLacunarity = 2.0;
const forestThreshold = 0.4;
const mountainThreshold = 0.5;
const CAVE_SEED_OFFSET = 10000;
const caveNoiseScale = 0.06;
const caveThreshold = 0.65;
const minCaveY = -60;
const maxCaveY = 40;

// All other generation functions (calculateTerrainInfo, generateTreeStructure, etc.) go here...
// --- PASTE ALL THE GENERATION/HELPER FUNCTIONS FROM index.js HERE ---
// e.g., smoothStep, getHeightForBiomeParams, calculateTerrainInfo,
// generateTreeStructure, generateOverworldChunkData, generateSpaceChunkData

function smoothStep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
function getHeightForBiomeParams(params, worldX, worldZ, baseLacunarity) {
  const terrainOctaves = params.terrainOctaves || FRACTAL_OCTAVES;
  const terrainPersistence = params.terrainPersistence || FRACTAL_PERSISTENCE;
  const terrainLacunarity = baseLacunarity || FRACTAL_LACUNARITY;
  const heightNoise = generateFractalNoise2D(
    simplex,
    worldX * params.terrainScale,
    worldZ * params.terrainScale,
    terrainOctaves,
    terrainPersistence,
    terrainLacunarity
  );
  const normalizedHeightNoise = (heightNoise + 1) / 2.0;
  let heightValue =
    params.baseHeight + normalizedHeightNoise * params.terrainAmplitude;
  if (params.hillAmplitude && params.hillScale) {
    const hillOctaves = params.hillOctaves || 3;
    const hillPersistence = params.hillPersistence || 0.5;
    const largeHillNoise = generateFractalNoise2D(
      simplex,
      worldX * params.hillScale,
      worldZ * params.hillScale,
      hillOctaves,
      hillPersistence,
      terrainLacunarity
    );
    heightValue += ((largeHillNoise + 1) / 2.0) * params.hillAmplitude;
  }
  if (
    typeof params.roughnessAmplitude !== "undefined" &&
    typeof params.roughnessScale !== "undefined"
  ) {
    heightValue +=
      simplex.noise2D(
        worldX * params.roughnessScale,
        worldZ * params.roughnessScale
      ) * params.roughnessAmplitude;
  }
  return heightValue;
}
function calculateTerrainInfo(worldX, worldZ) {
  const rawBiomeNoiseValue = generateFractalNoise2D(
    simplex,
    worldX * biomeNoiseScale,
    worldZ * biomeNoiseScale,
    biomeOctaves,
    biomePersistence,
    biomeLacunarity
  );
  const normalizedBiomeNoise = (rawBiomeNoiseValue + 1) / 2.0;
  const TRANSITION_ZONE_WIDTH = 0.15;
  let primaryBiome, secondaryBiome;
  let weightPrimary = 1.0,
    weightSecondary = 0.0;
  let dominantParams;
  if (normalizedBiomeNoise < forestThreshold) {
    primaryBiome = BiomeType.Plains;
    dominantParams = biomeParameters[BiomeType.Plains];
    if (normalizedBiomeNoise > forestThreshold - TRANSITION_ZONE_WIDTH) {
      secondaryBiome = BiomeType.Forest;
      const progressIntoForest =
        (normalizedBiomeNoise - (forestThreshold - TRANSITION_ZONE_WIDTH)) /
        TRANSITION_ZONE_WIDTH;
      weightSecondary = smoothStep(0, 1, progressIntoForest);
      weightPrimary = 1.0 - weightSecondary;
    }
  } else if (normalizedBiomeNoise < mountainThreshold) {
    primaryBiome = BiomeType.Forest;
    dominantParams = biomeParameters[BiomeType.Forest];
    if (normalizedBiomeNoise < forestThreshold + TRANSITION_ZONE_WIDTH) {
      secondaryBiome = BiomeType.Plains;
      const progressIntoPlains =
        (forestThreshold + TRANSITION_ZONE_WIDTH - normalizedBiomeNoise) /
        TRANSITION_ZONE_WIDTH;
      weightSecondary = smoothStep(0, 1, progressIntoPlains);
      weightPrimary = 1.0 - weightSecondary;
    } else if (
      normalizedBiomeNoise >
      mountainThreshold - TRANSITION_ZONE_WIDTH
    ) {
      secondaryBiome = BiomeType.Mountain;
      const progressIntoMountain =
        (normalizedBiomeNoise - (mountainThreshold - TRANSITION_ZONE_WIDTH)) /
        TRANSITION_ZONE_WIDTH;
      weightSecondary = smoothStep(0, 1, progressIntoMountain);
      weightPrimary = 1.0 - weightSecondary;
    }
  } else {
    primaryBiome = BiomeType.Mountain;
    dominantParams = biomeParameters[BiomeType.Mountain];
    if (normalizedBiomeNoise < mountainThreshold + TRANSITION_ZONE_WIDTH) {
      secondaryBiome = BiomeType.Forest;
      const progressIntoForest =
        (mountainThreshold + TRANSITION_ZONE_WIDTH - normalizedBiomeNoise) /
        TRANSITION_ZONE_WIDTH;
      weightSecondary = smoothStep(0, 1, progressIntoForest);
      weightPrimary = 1.0 - weightSecondary;
    }
  }
  const paramsPrimary = biomeParameters[primaryBiome];
  const paramsSecondary =
    secondaryBiome !== undefined ? biomeParameters[secondaryBiome] : null;
  let finalHeightValue = getHeightForBiomeParams(
    paramsPrimary,
    worldX,
    worldZ,
    paramsPrimary.terrainLacunarity || FRACTAL_LACUNARITY
  );
  if (paramsSecondary && weightSecondary > 0.001) {
    const heightSecondary = getHeightForBiomeParams(
      paramsSecondary,
      worldX,
      worldZ,
      paramsSecondary.terrainLacunarity || FRACTAL_LACUNARITY
    );
    finalHeightValue =
      finalHeightValue * weightPrimary + heightSecondary * weightSecondary;
  }
  const finalTerrainHeight = Math.floor(finalHeightValue);
  return {
    height: finalTerrainHeight,
    biome: primaryBiome,
    params: paramsPrimary,
  };
}
function generateTreeStructure(rX, rY, rZ, h, generatedBlocksMap) {
  for (let i = 0; i < h; i++) {
    const logKey = getBlockKey(rX, rY + i, rZ);
    internalAddBlock(rX, rY + i, rZ, "log");
    world[logKey] = { type: "log", solid: true };
    generatedBlocksMap[logKey] = world[logKey];
  }
  const lR = 2;
  const tTY = rY + h - 1;
  for (let ly = tTY - 1; ly <= tTY + 1; ly++) {
    for (let lx = -lR; lx <= lR; lx++) {
      for (let lz = -lR; lz <= lR; lz++) {
        const bX = rX + lx;
        const bY = ly;
        const bZ = rZ + lz;
        const leafKey = getBlockKey(bX, bY, bZ);
        if (!hasSolidBlock(bX, bY, bZ)) {
          internalAddBlock(bX, bY, bZ, "leaves");
          world[leafKey] = { type: "leaves", solid: true };
          generatedBlocksMap[leafKey] = world[leafKey];
        }
      }
    }
  }
  const topLeafKey = getBlockKey(rX, tTY + 2, rZ);
  if (!hasSolidBlock(rX, tTY + 2, rZ)) {
    internalAddBlock(rX, tTY + 2, rZ, "leaves");
    world[topLeafKey] = { type: "leaves", solid: true };
    generatedBlocksMap[topLeafKey] = world[topLeafKey];
  }
}
let generationId = 0;
parentPort.on("message", (msg) => {
  if (msg.type === "generateChunk") {
    // Pass the entire message object to the generation functions now
    if (msg.dimension === 'space') {
      generateSpaceChunkData(msg.chunk, msg.generationId); // Pass genId
    } else {
      generateOverworldChunkData(msg.chunk, msg.generationId); // Pass genId
    }
  } else if (msg.type === "unloadChunk") {
    removeChunkBlocksFromWorkerMemory(msg.cx, msg.cz);
  }
  else if(msg.type === "generationId"){
    generationId = msg.generationId
  }
  else if(msg.type === "resetWorld") {
    world = {};
    chunks.clear();
    generationId = 0; // Reset generation ID
    parentPort.postMessage({ type: "worldReset" });
  }
});
async function generateSpaceChunkData(chunk) {
    chunk.state = ChunkState.LoadingData;
    const generatedBlocks = {};
    const { wx: chunkStartX, wz: chunkStartZ } = chunkToWorldCoords(
      chunk.cx,
      chunk.cz
    );

    // --- Planet Placement & Separation Logic ---
    // CHANGE 1: Increase grid size and radius to make planets bigger and more separated.
    const planetGridSize = 1200; // Was 600. This is the main change for separation.
    const planetSearchRadius = 400;  // Was 250. Needs to be larger to find the more distant planets.

    const chunkMidX = chunkStartX + CHUNK_SIZE / 2;
    const chunkMidZ = chunkStartZ + CHUNK_SIZE / 2;
    const nearbyPlanets = [];

    for (let gridX = -1; gridX <= 1; gridX++) {
      for (let gridZ = -1; gridZ <= 1; gridZ++) {
        const currentGridX = Math.floor(chunkMidX / planetGridSize) + gridX;
        const currentGridZ = Math.floor(chunkMidZ / planetGridSize) + gridZ;

        const planetSeed = simpleHash(
          numericWorldSeed,
          currentGridX,
          currentGridZ,
          100
        );
        const random = createMulberry32(planetSeed);

        // Keep the chance the same, but they will be more spread out.
        if (random() < 0.2) {
          const planetCenterX =
            currentGridX * planetGridSize +
            (random() - 0.5) * (planetGridSize * 0.7);
          const planetCenterY = 64 + (random() - 0.5) * 100;
          const planetCenterZ =
            currentGridZ * planetGridSize +
            (random() - 0.5) * (planetGridSize * 0.7);
            
          // CHANGE 2: Increase the planet radius range.
          const planetRadius = 40 + random() * 50; // Was 25 + random() * 35. Now radius is between 40 and 90.

          const distToChunk = Math.sqrt(
            Math.pow(chunkMidX - planetCenterX, 2) +
              Math.pow(chunkMidZ - planetCenterZ, 2)
          );

          if (distToChunk < planetRadius + planetSearchRadius) {
            nearbyPlanets.push({
              x: planetCenterX,
              y: planetCenterY,
              z: planetCenterZ,
              radius: planetRadius,
            });
          }
        }
      }
    }

    // --- Block Generation Loop with Mixed Materials ---
    const asteroidNoiseScale = 0.05;
    const asteroidThreshold = 0.68;

    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let y = -64; y < 100; y++) {
          const worldX = chunkStartX + x;
          const worldY = y;
          const worldZ = chunkStartZ + z;

          let blockPlaced = false;

          // 1. Planet Generation
          for (const planet of nearbyPlanets) {
            const distToCenter = Math.sqrt(
              Math.pow(worldX - planet.x, 2) +
                Math.pow(worldY - planet.y, 2) +
                Math.pow(worldZ - planet.z, 2)
            );

            if (distToCenter <= planet.radius) {
              let blockType = "stone"; // Default to stone core

              // --- CHANGE 3: Add Coal and improve material mixing logic ---
              const oreNoiseScale = 0.1;

              // Use different offsets for each noise to get different patterns
              const ironNoise = simplex.noise3D(
                (worldX + 1000) * oreNoiseScale,
                worldY * oreNoiseScale,
                worldZ * oreNoiseScale
              );
              const coalNoise = simplex.noise3D(
                worldX * oreNoiseScale,
                (worldY - 2000) * oreNoiseScale, // Different Y offset
                worldZ * oreNoiseScale
              );

              // Determine the block type for the planet's interior
              if ((ironNoise + 1) / 2.0 > 0.8) {
                blockType = "oxidized_iron_ore";
              } else if ((coalNoise + 1) / 2.0 > 0.75) {
                blockType = "coal_ore";
              }

              // Create a cobblestone crust that OVERWRITES the interior blocks
              // This ensures the crust is always present on the surface.
              if (distToCenter > planet.radius - 3) {
                blockType = "cobblestone";
              }
              // --- End of Material Mixing Change ---

              internalAddBlock(worldX, worldY, worldZ, blockType, true);
              generatedBlocks[getBlockKey(worldX, worldY, worldZ)] =
                world[getBlockKey(worldX, worldY, worldZ)];
              blockPlaced = true;
              break;
            }
          }

          if (blockPlaced) continue;

          // 2. Asteroid Generation (if not in a planet)
          const asteroidNoise = simplex.noise3D(
            worldX * asteroidNoiseScale,
            worldY * asteroidNoiseScale,
            worldZ * asteroidNoiseScale
          );
          if ((asteroidNoise + 1) / 2.0 > asteroidThreshold) {
            internalAddBlock(worldX, worldY, worldZ, "stone", true);
            generatedBlocks[getBlockKey(worldX, worldY, worldZ)] =
              world[getBlockKey(worldX, worldY, worldZ)];
          }
        }
      }
    }
    const newlySpawnedMobs = [];
    const MOB_SPAWN_CHANCE = 0.005; // 0.5% chance per valid surface block

    // After generating blocks, iterate through them to find spawn locations
    for (const blockKey in generatedBlocks) {
        const block = generatedBlocks[blockKey];
        if (block && (block.type === 'cobblestone' || block.type === 'stone')) {
            const pos = blockKey.split('_').map(Number);
            const x = pos[0], y = pos[1], z = pos[2];

            // Check if the space directly above the block is empty for the mob to stand
            const blockAboveKey = getBlockKey(x, y + 1, z);
            if (!world[blockAboveKey] && Math.random() < MOB_SPAWN_CHANCE) {
                const mobId = `mob_${x}_${y+1}_${z}`;
                newlySpawnedMobs.push({
                    id: mobId,
                    type: 'space_turret',
                    position: { x: x + 0.5, y: y + 1, z: z + 0.5 }, // Spawn on top of the block
                    health: 10,
                    timeSinceLastShot: 0, // For server-side logic
                });
            }
        }
    }

    await saveChunkToFile(chunk.id, generatedBlocks);
    Object.assign(world, generatedBlocks);

    // Add the new mobs array to the message we send back
    parentPort.postMessage({
      type: "chunkDataLoaded",
      cx: chunk.cx,
      cz: chunk.cz,
      blocks: generatedBlocks,
      mobs: newlySpawnedMobs // <-- NEW
    });
}
 async function generateOverworldChunkData(chunk) {
  // This function contains all the original logic for generating a standard Overworld chunk.
  // It is called by the main generateChunkData "dispatcher" function.

  chunk.state = ChunkState.LoadingData;
  const generatedBlocks = {};
  const { wx: chunkStartX, wz: chunkStartZ } = chunkToWorldCoords(
    chunk.cx,
    chunk.cz
  );

  // --- TERRAIN GENERATION LOGIC ---
  const waterY = 8;
  for (let xLoop = 0; xLoop < CHUNK_SIZE; xLoop++) {
    for (let zLoop = 0; zLoop < CHUNK_SIZE; zLoop++) {
      const waterX = chunkStartX + xLoop;
      const waterZ = chunkStartZ + zLoop;
      const blockAtWaterLevel = getBlock(waterX, waterY, waterZ);
      if (!blockAtWaterLevel) {
        internalAddBlock(waterX, waterY, waterZ, "water");
        generatedBlocks[getBlockKey(waterX, waterY, waterZ)] =
          world[getBlockKey(waterX, waterY, waterZ)];
        for (let i = waterY - 1; i >= waterY - 3; i--) {
          if (!hasBlock(waterX, i, waterZ)) {
            internalAddBlock(waterX, i, waterZ, "water");
            generatedBlocks[getBlockKey(waterX, i, waterZ)] =
              world[getBlockKey(waterX, i, waterZ)];
          }
        }
      }
    }
  }
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const worldX = chunkStartX + x;
      const worldZ = chunkStartZ + z;
      if (worldX === 0 && worldZ === 10) {
        internalAddBlock(0, 25, 10, "furnace"); // testing
        generatedBlocks[getBlockKey(0, 25, 10)] = world[getBlockKey(0, 25, 10)];
      }
      const terrainInfo = calculateTerrainInfo(worldX, worldZ);
      const originalSurfaceY = terrainInfo.height;
      let actualSurfaceY = originalSurfaceY;
      const biomeParams = terrainInfo.params;
      const biomeType = terrainInfo.biome;
      const stoneStartY =
        originalSurfaceY -
        biomeParams.dirtDepth +
        biomeParams.stoneLevelModifier;
      const minYGen = -64;
      for (let y = minYGen; y <= actualSurfaceY; y++) {
        let blockTypeToPlace = "stone";
        if (y === actualSurfaceY) {
            blockTypeToPlace =
            biomeType === BiomeType.Mountain && y >= biomeParams.snowLevel
                ? "stone"
                : biomeParams.surfaceBlock;
        } else if (y > stoneStartY) {
            blockTypeToPlace = biomeParams.underSurfaceBlock;
        }
        if (y === minYGen) {
            blockTypeToPlace = "bedrock";
        }
        let isCaveAir = false;
        if (y >= minCaveY && y < actualSurfaceY && y <= maxCaveY) {
          const caveNoiseValue = simplex.noise3D(
            (worldX + CAVE_SEED_OFFSET) * caveNoiseScale,
            (y + CAVE_SEED_OFFSET) * caveNoiseScale,
            (worldZ + CAVE_SEED_OFFSET) * caveNoiseScale
          );
          if ((caveNoiseValue + 1) / 2.0 > caveThreshold) {
            isCaveAir = true;
          }
        }
        if (isCaveAir) {
          const existingBlockKey = getBlockKey(worldX, y, worldZ);
          if (world[existingBlockKey]) {
            world[existingBlockKey] = { type: "cave_air", solid: false };
            generatedBlocks[existingBlockKey] = world[existingBlockKey];
            generatedBlocks[existingBlockKey] = null;
          }
          continue;
        }
        world[getBlockKey(worldX, y, worldZ)] = null;
        generatedBlocks[getBlockKey(worldX, y, worldZ)] = null;
        internalAddBlock(worldX, y, worldZ, blockTypeToPlace, true);
        generatedBlocks[getBlockKey(worldX, y, worldZ)] =
          world[getBlockKey(worldX, y, worldZ)];
      }
      const oreNoiseScale = 0.08;
      const oreNoiseSeedOffset = 1000;
      const coalThreshold = 0.85;
      const coalMinY = 0;
      const coalMaxY = 128;
      const ironThreshold = 0.95;
      const ironMinY = -60;
      const ironMaxY = 70;
      const ironPeakY = 16;
      const ironSpread = 40;
      const oreCheckMinY = Math.max(minYGen + 1, minCaveY);
      const oreCheckMaxY = actualSurfaceY;
      for (let y = oreCheckMinY; y <= oreCheckMaxY; y++) {
        const blockKey = getBlockKey(worldX, y, worldZ);
        const currentBlock = world[blockKey];
        if (currentBlock && currentBlock.type === "stone") {
          if (y >= coalMinY && y <= coalMaxY) {
            const coalVeinNoise = simplex.noise3D(
              (worldX + oreNoiseSeedOffset) * oreNoiseScale,
              (y + oreNoiseSeedOffset) * oreNoiseScale * 0.8,
              (worldZ + oreNoiseSeedOffset) * oreNoiseScale
            );
            if ((coalVeinNoise + 1) / 1.5 > coalThreshold) {
              let isExposed = false;
              const neighbors = [
                { dx: 1, dy: 0, dz: 0 },
                { dx: -1, dy: 0, dz: 0 },
                { dx: 0, dy: 1, dz: 0 },
                { dx: 0, dy: -1, dz: 0 },
                { dx: 0, dy: 0, dz: 1 },
                { dx: 0, dy: 0, dz: -1 },
              ];
              for (const n of neighbors) {
                if (!hasBlock(worldX + n.dx, y + n.dy, worldZ + n.dz)) {
                  isExposed = true;
                  break;
                }
              }
              let placeThisOre = true;
              if (isExposed) {
                const coalExposureSeed = simpleHash(
                  numericWorldSeed,
                  worldX,
                  y,
                  worldZ,
                  1
                );
                const randomCoalExposure = createMulberry32(coalExposureSeed);
                if (randomCoalExposure() >= 0.5) placeThisOre = false;
              }
              if (placeThisOre) {
                internalAddBlock(worldX, y, worldZ, "coal_ore", true);
                generatedBlocks[blockKey] = world[blockKey];
                continue;
              }
            }
          }
          const currentBlockAfterCoal = world[blockKey];
          if (
            currentBlockAfterCoal &&
            currentBlockAfterCoal.type === "stone" &&
            y >= ironMinY &&
            y <= ironMaxY
          ) {
            const distFromPeak = Math.abs(y - ironPeakY);
            const normalizedDist = Math.min(1.0, distFromPeak / ironSpread);
            const currentIronThreshold =
              ironThreshold + normalizedDist * (2.0 - ironThreshold);
            const ironVeinNoise = simplex.noise3D(
              (worldX - oreNoiseSeedOffset) * oreNoiseScale * 1.1,
              (y - oreNoiseSeedOffset) * oreNoiseScale * 0.9,
              (worldZ - oreNoiseSeedOffset) * oreNoiseScale * 1.1
            );
            if ((ironVeinNoise + 1) / 2.0 > currentIronThreshold) {
              let isExposed = false;
              const neighbors = [
                { dx: 1, dy: 0, dz: 0 },
                { dx: -1, dy: 0, dz: 0 },
                { dx: 0, dy: 1, dz: 0 },
                { dx: 0, dy: -1, dz: 0 },
                { dx: 0, dy: 0, dz: 1 },
                { dx: 0, dy: 0, dz: -1 },
              ];
              for (const n of neighbors) {
                if (!hasBlock(worldX + n.dx, y + n.dy, worldZ + n.dz)) {
                  isExposed = true;
                  break;
                }
              }
              let placeThisOre = true;
              if (isExposed) {
                const ironExposureSeed = simpleHash(
                  numericWorldSeed,
                  worldX,
                  y,
                  worldZ,
                  2
                );
                const randomIronExposure = createMulberry32(ironExposureSeed);
                if (randomIronExposure() >= 0.5) placeThisOre = false;
              }
              if (placeThisOre) {
                internalAddBlock(worldX, y, worldZ, "oxidized_iron_ore", true);
                generatedBlocks[blockKey] = world[blockKey];
              }
            }
          }
        }
      }
      const surfaceBlockData = getBlock(worldX, actualSurfaceY, worldZ);
      const surfaceBlockType = surfaceBlockData ? surfaceBlockData.type : null;
      if (
        (surfaceBlockType === biomeParams.surfaceBlock ||
          surfaceBlockType === "dirt") &&
        actualSurfaceY < (biomeParams.snowLevel ?? Infinity) &&
        actualSurfaceY > 0
      ) {
        let treeDensity = biomeParams.treeDensity;
        let treeHeightMin = biomeParams.treeHeightMin;
        let treeHeightMax = biomeParams.treeHeightMax;
        if (
          biomeType === BiomeType.Plains &&
          biomeParams.plainsForestPatchChance > 0
        ) {
          const plainsPatchSeed = simpleHash(
            numericWorldSeed,
            worldX,
            worldZ,
            3
          );
          const randomPlainsPatch = createMulberry32(plainsPatchSeed);
          if (randomPlainsPatch() < biomeParams.plainsForestPatchChance) {
            treeDensity =
              biomeParams.plainsForestPatchDensity ||
              biomeParameters[BiomeType.Forest].treeDensity;
            treeHeightMin = biomeParameters[BiomeType.Forest].treeHeightMin;
            treeHeightMax = biomeParameters[BiomeType.Forest].treeHeightMax;
          }
        }
        const treePlacementSeed = simpleHash(
          numericWorldSeed,
          worldX,
          worldZ,
          4
        );
        const randomTreePlacement = createMulberry32(treePlacementSeed);
        if (randomTreePlacement() < treeDensity) {
          const heightNorth = calculateTerrainInfo(worldX, worldZ + 1).height;
          const heightSouth = calculateTerrainInfo(worldX, worldZ - 1).height;
          const heightEast = calculateTerrainInfo(worldX + 1, worldZ).height;
          const heightWest = calculateTerrainInfo(worldX - 1, worldZ).height;
          const maxSlope = Math.max(
            Math.abs(actualSurfaceY - heightNorth),
            Math.abs(actualSurfaceY - heightSouth),
            Math.abs(actualSurfaceY - heightEast),
            Math.abs(actualSurfaceY - heightWest)
          );
          if (maxSlope <= 2) {
            const treeHeightSeed = simpleHash(
              numericWorldSeed,
              worldX,
              actualSurfaceY,
              worldZ,
              5
            );
            const randomTreeHeight = createMulberry32(treeHeightSeed);
            const treeHeight =
              treeHeightMin +
              Math.floor(
                randomTreeHeight() * (treeHeightMax - treeHeightMin + 1)
              );
            generateTreeStructure(
              worldX,
              actualSurfaceY + 1,
              worldZ,
              treeHeight,
              generatedBlocks
            );
          }
        }
      }
    }
  }
  const landminesPerChunk = 6;
  for (let i = 0; i < landminesPerChunk; i++) {
    const landmineX = chunkStartX + Math.floor(Math.random() * CHUNK_SIZE);
    const landmineZ = chunkStartZ + Math.floor(Math.random() * CHUNK_SIZE);
    const surfaceInfo = calculateTerrainInfo(landmineX, landmineZ);
    const surfaceY = surfaceInfo.height;
    const blockToReplace = getBlock(landmineX, surfaceY, landmineZ);
    if (
      blockToReplace &&
      (blockToReplace.type === "grass" || blockToReplace.type === "dirt")
    ) {
      internalAddBlock(landmineX, surfaceY, landmineZ, "landmine", true);
      generatedBlocks[getBlockKey(landmineX, surfaceY, landmineZ)] =
        world[getBlockKey(landmineX, surfaceY, landmineZ)];
    }
  }
  // --- End of terrain generation logic ---

  // 2. SAVE the newly generated blocks to a file for persistence
  await saveChunkToFile(chunk.id, generatedBlocks);

  // 3. Load the new blocks into the active in-memory world cache
  Object.assign(world, generatedBlocks);

  // 4. Tell the client about these newly generated blocks
    parentPort.postMessage({
    type: "chunkDataLoaded",
    cx: chunk.cx,
    cz: chunk.cz,
    blocks: generatedBlocks,
    });
  console.log("[worker] sent blocks to server");

  chunk.state = ChunkState.DataLoaded;
  chunksNeedUpdate = true;
}
  async function saveChunkToFile(chunkId, chunkObject) {
    const chunkPath = path.join(worldDirectory, `${chunkId}.json`);
    try {
      const data = JSON.stringify(chunkObject, null, 2); // Pretty-print JSON
      await fs.writeFile(chunkPath, data);
      // console.log(`Successfully saved chunk ${chunkId}`);
    } catch (error) {
      console.error(`Error saving chunk ${chunkId}:`, error);
    }
  }

  async function loadChunkFromFile(chunkId) {
    const chunkPath = path.join(worldDirectory, `${chunkId}.json`);
    try {
      const data = await fs.readFile(chunkPath, "utf8");
      try {
        return JSON.parse(data);
      } catch (parseError) {
        console.error(`Corrupted chunk ${chunkId}: ${parseError.message}`);
        await fs.unlink(chunkPath); // Delete corrupted file
        return null;
      }
    } catch (error) {
      if (error.code === "ENOENT") return null;
      console.error(`Error loading chunk ${chunkId}:`, error);
      return null;
    }
  }
