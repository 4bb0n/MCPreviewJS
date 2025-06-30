
/*
    most of the code in this file is human written.
    Well, not really, I copied it from the overworld.html.

    Still, I call it human written because I had to change a lot of things to make it work, and I know the concept of it.
    Especially how workers work.

    I got the AI to help me with debugging and the rendering part on the overworld side, that's it!

    Parts AI helped:
    - The weird material.uuid that is unecessary and could just be material
    - The chunk mesh data transfer
    - The last parts of meshChunk() function
    
    What I learned from the AI:
    - Three js objects can't be cloned through transfer.
    - The chunk mesh data transfer

    Edit 29/06/2025:
    It's a server now. And I did this completely by myself.
    The AI did suggest some solutions to some bug but mine was much
    quicker and more creative.
    AI = Gemini 2.5 Pro Deep Think.
*/
const THREE = require('three');
const {
    SimplexNoise,
    generateFractalNoise2D,
    generateFractalNoise3D,
    createMulberry32,
    simpleHash,
    WORLD_SEED,
    numericWorldSeed
} = require('./simplexNoise.js');

const express = require('express');
const http = require('http');
const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const fs = require('fs').promises
const path = require('path');
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/overworld.html');
})
app.get('/three.js', (req, res) => {
    res.sendFile(__dirname + '/three.js');
})
app.get('/breaking.js', (req, res) => {
    res.sendFile(__dirname + '/breaking.js');
})
app.get('/heldItem.js', (req, res) => {
    res.sendFile(__dirname + '/heldItem.js');
})
app.get('/db.js', (req, res) => {
    res.sendFile(__dirname + '/db.js');
})
app.get('/mobs.js', (req, res) => {
    res.sendFile(__dirname + '/mobs.js');
})
app.get('/GLTFLoader.js', (req, res) => {
    res.sendFile(__dirname + '/GLTFLoader.js');
})
app.get('holdItemAnimation.js', (req, res) => {
    res.sendFile(__dirname + '/holdItemAnimation.js');
})
app.use('/textures', express.static(__dirname + '/textures'));

let camera = {
    position: { x: 0, y: 0, z: 0 },
}
const CHUNK_SIZE = 16;
const faceGeometries = {};
const RENDER_DISTANCE = 1;
const MAX_INSTANCES_PER_GEOMETRY_PER_CHUNK = 100000
const dummy = new THREE.Object3D();
let chunksNeedUpdate = true;
let scene;
let world = {}
let chunks = new Map();
faceGeometries.right = new THREE.PlaneGeometry(1, 1)
  .rotateY(Math.PI / 2)
  .translate(0.5, 0, 0);
faceGeometries.left = new THREE.PlaneGeometry(1, 1)
  .rotateY(-Math.PI / 2)
  .translate(-0.5, 0, 0);
faceGeometries.top = new THREE.PlaneGeometry(1, 1)
  .rotateX(-Math.PI / 2)
  .translate(0, 0.5, 0);
faceGeometries.bottom = new THREE.PlaneGeometry(1, 1)
  .rotateX(Math.PI / 2)
  .translate(0, -0.5, 0);
faceGeometries.front = new THREE.PlaneGeometry(1, 1).translate(0, 0, 0.5);
faceGeometries.back = new THREE.PlaneGeometry(1, 1)
  .rotateY(Math.PI)
  .translate(0, 0, -0.5);
faceGeometries.right.name = "right";
faceGeometries.left.name = "left";
faceGeometries.top.name = "top";
faceGeometries.bottom.name = "bottom";
faceGeometries.front.name = "front";
faceGeometries.back.name = "back";
const ChunkState = {
    Unknown: 0,
    LoadingData: 1,
    DataLoaded: 2,
    Meshing: 3,
    Active: 4,
    Inactive: 5,
    NeedsRemesh: 6,
  };
  function worldToChunkCoords(worldX, worldZ) {
    const cx = Math.floor(worldX / CHUNK_SIZE);
    const cz = Math.floor(worldZ / CHUNK_SIZE);
    return { cx, cz };
  }
    function getChunkId(chunkX, chunkZ) {
        return `${chunkX}_${chunkZ}`;
}

const worldDirectory = path.join(__dirname, 'world');

// Function to ensure the world directory exists when the server starts
async function setupWorldDirectory() {
    try {
        await fs.mkdir(worldDirectory);
        console.log(`Created world directory at: ${worldDirectory}`);
    } catch (error) {
        if (error.code === 'EEXIST') {
            console.log('World directory already exists.');
        } else {
            console.error('Error creating world directory:', error);
        }
    }
}
function removeChunkBlocksFromServerMemory(chunk) {
    if (!chunk) return;
    // console.log(`[Server] Unloading blocks for chunk ${chunk.id} from memory.`);
    const { wx: chunkStartX, wz: chunkStartZ } = chunkToWorldCoords(chunk.cx, chunk.cz);
    // Use the same vertical bounds as your generator to ensure all blocks are checked.
    const minYGen = -64;
    const maxYGen = 128;

    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            // Iterate through the full possible height of the world
            for (let y = minYGen; y <= maxYGen; y++) {
                const blockKey = getBlockKey(chunkStartX + x, y, chunkStartZ + z);
                // If the block exists in our in-memory world, delete it.
                if (world[blockKey]) {
                    delete world[blockKey];
                }
            }
        }
    }
}
setupWorldDirectory();

io.on('connection', (socket) => {
                  console.log('A user connected. Resetting world and chunks for new session.');
  world = {};
  chunks.clear();
  chunksNeedUpdate = true; // IMPORTANT: Signal that the loop needs to run

  // Immediately start the chunk generation process for the spawn area
  updateChunks();

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
            const data = await fs.readFile(chunkPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                // File doesn't exist, which is normal for a new chunk
                return null;
            }
            console.error(`Error loading chunk ${chunkId}:`, error);
            return null;
        }
    }
      function meshChunk(chunk) {
        if (!chunk || chunk.state === ChunkState.LoadingData || chunk.state === ChunkState.Unknown) {
            console.warn(`Worker: Attempted meshChunk for ${chunk?.id} while state is ${chunk?.state}. Aborting.`);
            return;
        }
        if (!world || Object.keys(world).length === 0) {
            console.warn(`Worker: Attempted meshChunk for ${chunk.id} but worker world data is empty. Aborting.`);
            return;
        }
    
        // console.log(`Worker: Starting meshChunk for ${chunk.id} (State: ${chunk.state})`);
        chunk.state = ChunkState.Meshing;
        chunk.meshes = new Map(); // Worker's temporary map for this mesh pass
        const { wx: sX, wz: sZ } = chunkToWorldCoords(chunk.cx, chunk.cz);
        let facesAdded = 0;
        const faces = [ { face: "right", dx: 1, dy: 0, dz: 0 }, { face: "left", dx: -1, dy: 0, dz: 0 }, { face: "top", dx: 0, dy: 1, dz: 0 }, { face: "bottom", dx: 0, dy: -1, dz: 0 }, { face: "front", dx: 0, dy: 0, dz: 1 }, { face: "back", dx: 0, dy: 0, dz: -1 } ];
        const minBY = -64; const maxBY = 128; // Use generation bounds
    
        for (let x = 0; x < CHUNK_SIZE; x++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                let colMinY = maxBY, colMaxY = minBY;
                for(let yCheck=minBY; yCheck<=maxBY; yCheck++) { if(hasBlock(sX+x, yCheck, sZ+z)) { colMinY=Math.min(colMinY, yCheck); colMaxY=Math.max(colMaxY, yCheck); } }
                colMinY = Math.max(minBY, colMinY-1); colMaxY = Math.min(maxBY, colMaxY+1);
    
                for (let y = colMinY; y <= colMaxY; y++) {
                    const blockCoordX = sX + x; const blockCoordY = y; const blockCoordZ = sZ + z;
                    const bD = getBlock(blockCoordX, blockCoordY, blockCoordZ); // Current block data
    
                    if (bD) {
                        if (typeof bD.type === 'undefined') {
                            console.error(`Worker: MeshChunk Loop - Block at ${blockCoordX},${blockCoordY},${blockCoordZ} has undefined type! Skipping. BD:`, JSON.stringify(bD));
                            continue;
                        }
    
                        const isCurrentBlockSolid = bD.solid === true; // Check solidity of the current block
    
                        faces.forEach((faceDirection) => {
                            const nX = blockCoordX + faceDirection.dx;
                            const nY = blockCoordY + faceDirection.dy;
                            const nZ = blockCoordZ + faceDirection.dz;
                            const nB = getBlock(nX, nY, nZ); // Neighbor block data
    
                            let shouldRenderFace = false; // Default to not rendering
    
                            if (!nB) {
                                // Neighbor is air - always render the face
                                shouldRenderFace = true;
                            } else {
                                // Neighbor exists, check types and solidity
                                const isNeighborSolid = nB.solid === true;
    
                                if (isCurrentBlockSolid && !isNeighborSolid) {
                                    // Current is Solid, Neighbor is Non-Solid (e.g., Stone next to Water/Leaves)
                                    // -> Render the solid block's face
                                    shouldRenderFace = true;
                                } else if (!isCurrentBlockSolid && !isNeighborSolid) {
                                    // Current is Non-Solid, Neighbor is Non-Solid (e.g., Water next to Water/Leaves)
                                    // -> Render face ONLY if they are DIFFERENT types
                                    if (bD.type !== nB.type) {
                                        shouldRenderFace = true;
                                    }
                                    // -> Do NOT render if they are the SAME non-solid type (Water next to Water is culled)
                                } else if (!isCurrentBlockSolid && isNeighborSolid) {
                                    // Current is Non-Solid, Neighbor is Solid (e.g., Water next to Stone)
                                    // -> Render the non-solid block's face (e.g. water face against stone)
                                    // Note: If your non-solid blocks are transparent (like water), you might
                                    // want the solid block behind it to render *its* face instead, handled above.
                                    // If non-solid blocks are opaque (like maybe custom foliage), render this face.
                                    // For typical water/leaves, we usually want this face to render.
                                    shouldRenderFace = true;
                                }
                                // Implicit else: (isCurrentBlockSolid && isNeighborSolid)
                                // -> Solid next to Solid: Face is culled (shouldRenderFace remains false)
                            }
    
                            // Add the face if needed
                            if (shouldRenderFace) {
                                addBlockInstanceFace(
                                    chunk,
                                    blockCoordX, blockCoordY, blockCoordZ,
                                    bD.type,
                                    faceDirection.face
                                );
                                facesAdded++;
                            }
                        }); // End faces.forEach
                    } // End if(bD)
                } // End y loop
            } // End z loop
        } // End x loop
    
        // --- Consolidate and Send Data (No changes needed here) ---
        const meshDataArray = [];
        chunk.meshes.forEach((meshData) => {
            if (meshData.count > 0) {
                const matricesArray = new Float32Array(meshData.matrices);
                meshDataArray.push({
                    materialIdentifier: meshData.material, faceName: meshData.faceName,
                    matrices: matricesArray.buffer, count: meshData.count
                });
            }
        });
        try {
            if (meshDataArray.length > 0) {
                const transferables = meshDataArray.map(data => data.matrices);
                socket.emit('chunkMeshData', { chunkId: chunk.id, meshDataArray: meshDataArray }, transferables);
            } else {
                socket.emit('chunkMeshEmpty', { chunkId: chunk.id });
            }
        } catch (postError) {
             console.error(`Worker: Error posting mesh message for chunk ${chunk.id}:`, postError);
        } finally {
            chunk.state = ChunkState.DataLoaded; // Set state back after meshing
            // console.log(`Worker: Finished meshChunk for ${chunk.id}, state set to DataLoaded. Faces: ${facesAdded}`);
        }
    }
  function getMaterialIdentifierForBlockFace(blockType, faceName) {
    // ... (return 'grass_top', 'stone_all', etc. based on type/face)
    // (Copy the implementation from the previous answer)
        if (blockType === 'grass') {
        if (faceName === 'top') return 'grass_top';
        if (faceName === 'bottom') return 'grass_bottom';
        return 'grass_side';
    }
    if (blockType === 'log') {
        if (faceName === 'top' || faceName === 'bottom') return 'log_top';
        return 'log_side';
    }
    if (blockType === 'leaves') return 'leaves_all';
    if (blockType === 'dirt') return 'dirt_all';
    if (blockType === 'stone') return 'stone_all';
    if (blockType === 'plank') return 'plank_all';
    if (blockType === 'craftingtable') {
         if (faceName === 'top') return 'craftingtable_top';
         if (faceName === 'bottom') return 'craftingtable_bottom';
         return 'craftingtable_side';
    }
     if (blockType === 'cobblestone') return 'cobblestone_all';
     if (blockType === 'coal_ore') return 'coal_ore_all';
     if (blockType === 'oxidized_iron_ore') return 'oxidized_iron_ore_all';
     if (blockType === 'water') return 'water_all';
     if (blockType === 'bedrock') return 'bedrock_all';
     if (blockType === 'cave_air') return 'cave_air_all';
    if (blockType === 'air') return 'air_all';
    if(blockType == "furnace"){
        if(faceName == "front") return "furnace_front";
        if(faceName == "top") return "furnace_top";
        if(faceName == "bottom") return "furnace_bottom";
        return "furnace_side";
    }
    if (blockType === 'landmine') return "landmine_all";

    console.warn(`No material identifier found for block type: ${blockType}, face: ${faceName}`);
    return 'dirt_all'; // Fallback
  }

  function updateChunks() {
    const desired = new Set();
    if (!chunksNeedUpdate) return;
    chunksNeedUpdate = false;

    const { cx: pCX, cz: pCZ } = worldToChunkCoords(
      camera.position.x,
      camera.position.z
    );

    for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
      for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
        desired.add(getChunkId(pCX + dx, pCZ + dz));
      }
    }

    for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
      for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
        const tCX = pCX + dx;
        const tCZ = pCZ + dz;
        const cId = getChunkId(tCX, tCZ);
        let ch = chunks.get(cId);

        if (!ch) {
          ch = { id: cId, cx: tCX, cz: tCZ, state: ChunkState.Unknown };
          chunks.set(cId, ch);
        }

        if (ch.state === ChunkState.Unknown) {
          ch.state = ChunkState.LoadingData;
          // Use an immediately-invoked async function to call our new async data loader
          (async () => {
              // console.time(`loadOrGenerate for ${cId}`);
              await generateChunkData(ch); // This now handles both loading and generating
              // console.timeEnd(`loadOrGenerate for ${cId}`);
              chunksNeedUpdate = true; // Signal that the loop might need to run again for meshing
          })();
        } else if (ch.state === ChunkState.DataLoaded || ch.state === ChunkState.NeedsRemesh) {
          try {
            meshChunk(ch);
            ch.state = ChunkState.Active;
          } catch (e) {
            console.error(`Error meshing chunk ${cId}:`, e);
            ch.state = ChunkState.DataLoaded;
          }
        } else if (ch.state === ChunkState.Inactive) {
          ch.state = ChunkState.NeedsRemesh;
          chunksNeedUpdate = true;
        }
      }
    }

    // This loop now handles UNLOADING chunks from memory
    chunks.forEach((ch, cId) => {
      if (!desired.has(cId) && (ch.state === ChunkState.Active || ch.state === ChunkState.DataLoaded)) {
        socket.emit("disposeChunkMesh", cId);
        
        // --- THIS IS THE CRITICAL CHANGE FOR PERFORMANCE ---
        // Before deleting the chunk metadata, remove its blocks from the server's memory.
        removeChunkBlocksFromServerMemory(ch);
        
        chunks.delete(cId);
        // console.log(`[Server] Unloaded chunk ${cId} completely.`);
      }
    });
  }
  // --- In chunkWorker.js ---

// ASSUMPTIONS:
// - CHUNK_SIZE, RENDER_DISTANCE (if used by worker's update logic)
// - ChunkState object
// - numericWorldSeed (derived from WORLD_SEED string)
// - simplex (new SimplexNoise(WORLD_SEED) instance)
// - biomeParameters, BiomeType, and all related noise constants
// - CAVE_SEED_OFFSET, caveNoiseScale, caveThreshold, minCaveY, maxCaveY
// - createMulberry32(seed) function
// - simpleHash(...args) function
// - chunkToWorldCoords(cx, cz)
// - getBlockKey(x, y, z)
// - internalAddBlock(x, y, z, type, overwrite) -> updates worker's 'world'
// - getBlock(x, y, z) -> reads from worker's 'world'
// - hasBlock(x, y, z) -> reads from worker's 'world'
// - hasSolidBlock(x, y, z) -> reads from worker's 'world'
// - calculateTerrainInfo(wx, wz)
// - getBiome(wx, wz)
// - generateTreeStructure(rx, ry, rz, h, generatedBlocksMap) -> also calls internalAddBlock & updates map
async function generateChunkData(chunk) {
    if (!chunk) {
        console.error("Server: generateChunkData called with undefined chunk object!");
        return;
    }

    // 1. ATTEMPT TO LOAD FROM FILE FIRST
    const loadedBlocks = await loadChunkFromFile(chunk.id);

    if (loadedBlocks) {
        // --- SUCCESS: The chunk file exists. Load it into memory. ---
        // console.log(`[Server] Loaded chunk ${chunk.id} from file.`);
        Object.assign(world, loadedBlocks); // Load the file's blocks into the active world

        // Tell the client about these blocks
        socket.emit('chunkDataLoaded', {
            cx: chunk.cx,
            cz: chunk.cz,
            blocks: loadedBlocks
        });

        chunk.state = ChunkState.DataLoaded;
        chunksNeedUpdate = true;

    } else {
        // --- FAILURE: No file found. Generate a new chunk. ---
        // console.log(`[Server] No file for ${chunk.id}. Generating new chunk data...`);
        chunk.state = ChunkState.LoadingData;
        const generatedBlocks = {};
        const { wx: chunkStartX, wz: chunkStartZ } = chunkToWorldCoords(chunk.cx, chunk.cz);

        // --- ALL OF YOUR ORIGINAL TERRAIN GENERATION LOGIC GOES HERE ---
        // (This is a simplified paste of your code, no changes needed inside this block)
        const waterY = 8;
        for (let xLoop = 0; xLoop < CHUNK_SIZE; xLoop++) {
            for (let zLoop = 0; zLoop < CHUNK_SIZE; zLoop++) {
                const waterX = chunkStartX + xLoop;
                const waterZ = chunkStartZ + zLoop;
                const blockAtWaterLevel = getBlock(waterX, waterY, waterZ);
                if (!blockAtWaterLevel) {
                    internalAddBlock(waterX, waterY, waterZ, 'water');
                    generatedBlocks[getBlockKey(waterX, waterY, waterZ)] = world[getBlockKey(waterX, waterY, waterZ)];
                    for (let i = waterY - 1; i >= waterY - 3; i--) {
                        if (!hasBlock(waterX, i, waterZ)) {
                            internalAddBlock(waterX, i, waterZ, 'water');
                            generatedBlocks[getBlockKey(waterX, i, waterZ)] = world[getBlockKey(waterX, i, waterZ)];
                        }
                    }
                }
            }
        }
        for (let x = 0; x < CHUNK_SIZE; x++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                const worldX = chunkStartX + x;
                const worldZ = chunkStartZ + z;
                if(worldX === 0 && worldZ === 10){
                  internalAddBlock(0, 25, 10, 'furnace') // testing
                   generatedBlocks[getBlockKey(0, 25, 10)] = world[getBlockKey(0, 25, 10)]
                  }
                const terrainInfo = calculateTerrainInfo(worldX, worldZ);
                const originalSurfaceY = terrainInfo.height;
                let actualSurfaceY = originalSurfaceY;
                const biomeParams = terrainInfo.params;
                const biomeType = terrainInfo.biome;
                const stoneStartY = originalSurfaceY - biomeParams.dirtDepth + biomeParams.stoneLevelModifier;
                const minYGen = -64;
                for (let y = minYGen; y <= actualSurfaceY; y++) {
                    let isCaveAir = false;
                    if (y >= minCaveY && y < actualSurfaceY && y <= maxCaveY) {
                        const caveNoiseValue = simplex.noise3D((worldX + CAVE_SEED_OFFSET) * caveNoiseScale, (y + CAVE_SEED_OFFSET) * caveNoiseScale, (worldZ + CAVE_SEED_OFFSET) * caveNoiseScale);
                        if (((caveNoiseValue + 1) / 2.0) > caveThreshold) { isCaveAir = true; }
                    }
                    if (isCaveAir) {
                        const existingBlockKey = getBlockKey(worldX, y, worldZ);
                        if (world[existingBlockKey]) {
                            world[existingBlockKey] = { type: 'cave_air', solid: false };
                            generatedBlocks[existingBlockKey] = world[existingBlockKey];
                            generatedBlocks[existingBlockKey] = null
                        }
                        continue;
                    }
                    let blockTypeToPlace = 'stone';
                    if (y === actualSurfaceY) { blockTypeToPlace = (biomeType === BiomeType.Mountain && y >= biomeParams.snowLevel) ? 'stone' : biomeParams.surfaceBlock;
                    } else if (y > stoneStartY) { blockTypeToPlace = biomeParams.underSurfaceBlock; }
                    if (y === minYGen) { blockTypeToPlace = 'bedrock'; }
                    world[getBlockKey(worldX, y, worldZ)] = null
                    generatedBlocks[getBlockKey(worldX, y, worldZ)] = null
                    internalAddBlock(worldX, y, worldZ, blockTypeToPlace, true);
                    generatedBlocks[getBlockKey(worldX, y, worldZ)] = world[getBlockKey(worldX, y, worldZ)];
                }
                const oreNoiseScale = 0.08; const oreNoiseSeedOffset = 1000; const coalThreshold = 0.85; const coalMinY = 0; const coalMaxY = 128; const ironThreshold = 0.95; const ironMinY = -60; const ironMaxY = 70; const ironPeakY = 16; const ironSpread = 40; const oreCheckMinY = Math.max(minYGen + 1, minCaveY); const oreCheckMaxY = actualSurfaceY;
                for (let y = oreCheckMinY; y <= oreCheckMaxY; y++) {
                    const blockKey = getBlockKey(worldX, y, worldZ); const currentBlock = world[blockKey];
                    if (currentBlock && currentBlock.type === 'stone') {
                        if (y >= coalMinY && y <= coalMaxY) { const coalVeinNoise = simplex.noise3D((worldX + oreNoiseSeedOffset) * oreNoiseScale, (y + oreNoiseSeedOffset) * oreNoiseScale * 0.8, (worldZ + oreNoiseSeedOffset) * oreNoiseScale); if (((coalVeinNoise + 1) / 1.5) > coalThreshold) { let isExposed = false; const neighbors = [{ dx: 1, dy: 0, dz: 0 }, { dx: -1, dy: 0, dz: 0 }, { dx: 0, dy: 1, dz: 0 }, { dx: 0, dy: -1, dz: 0 }, { dx: 0, dy: 0, dz: 1 }, { dx: 0, dy: 0, dz: -1 }]; for (const n of neighbors) { if (!hasBlock(worldX + n.dx, y + n.dy, worldZ + n.dz)) { isExposed = true; break; } } let placeThisOre = true; if (isExposed) { const coalExposureSeed = simpleHash(numericWorldSeed, worldX, y, worldZ, 1); const randomCoalExposure = createMulberry32(coalExposureSeed); if (randomCoalExposure() >= 0.5) placeThisOre = false; } if (placeThisOre) { internalAddBlock(worldX, y, worldZ, 'coal_ore', true); generatedBlocks[blockKey] = world[blockKey]; continue; } } }
                        const currentBlockAfterCoal = world[blockKey];
                        if (currentBlockAfterCoal && currentBlockAfterCoal.type === 'stone' && y >= ironMinY && y <= ironMaxY) { const distFromPeak = Math.abs(y - ironPeakY); const normalizedDist = Math.min(1.0, distFromPeak / ironSpread); const currentIronThreshold = ironThreshold + normalizedDist * (2.0 - ironThreshold); const ironVeinNoise = simplex.noise3D((worldX - oreNoiseSeedOffset) * oreNoiseScale * 1.1, (y - oreNoiseSeedOffset) * oreNoiseScale * 0.9, (worldZ - oreNoiseSeedOffset) * oreNoiseScale * 1.1); if (((ironVeinNoise + 1) / 2.0) > currentIronThreshold) { let isExposed = false; const neighbors = [{ dx: 1, dy: 0, dz: 0 }, { dx: -1, dy: 0, dz: 0 }, { dx: 0, dy: 1, dz: 0 }, { dx: 0, dy: -1, dz: 0 }, { dx: 0, dy: 0, dz: 1 }, { dx: 0, dy: 0, dz: -1 }]; for (const n of neighbors) { if (!hasBlock(worldX + n.dx, y + n.dy, worldZ + n.dz)) { isExposed = true; break; } } let placeThisOre = true; if (isExposed) { const ironExposureSeed = simpleHash(numericWorldSeed, worldX, y, worldZ, 2); const randomIronExposure = createMulberry32(ironExposureSeed); if (randomIronExposure() >= 0.5) placeThisOre = false; } if (placeThisOre) { internalAddBlock(worldX, y, worldZ, 'oxidized_iron_ore', true); generatedBlocks[blockKey] = world[blockKey]; } } }
                    }
                }
                const surfaceBlockData = getBlock(worldX, actualSurfaceY, worldZ); const surfaceBlockType = surfaceBlockData ? surfaceBlockData.type : null;
                if ((surfaceBlockType === biomeParams.surfaceBlock || surfaceBlockType === 'dirt') && actualSurfaceY < (biomeParams.snowLevel ?? Infinity) && actualSurfaceY > 0) { let treeDensity = biomeParams.treeDensity; let treeHeightMin = biomeParams.treeHeightMin; let treeHeightMax = biomeParams.treeHeightMax; if (biomeType === BiomeType.Plains && biomeParams.plainsForestPatchChance > 0) { const plainsPatchSeed = simpleHash(numericWorldSeed, worldX, worldZ, 3); const randomPlainsPatch = createMulberry32(plainsPatchSeed); if (randomPlainsPatch() < biomeParams.plainsForestPatchChance) { treeDensity = biomeParams.plainsForestPatchDensity || biomeParameters[BiomeType.Forest].treeDensity; treeHeightMin = biomeParameters[BiomeType.Forest].treeHeightMin; treeHeightMax = biomeParameters[BiomeType.Forest].treeHeightMax; } } const treePlacementSeed = simpleHash(numericWorldSeed, worldX, worldZ, 4); const randomTreePlacement = createMulberry32(treePlacementSeed); if (randomTreePlacement() < treeDensity) { const heightNorth = calculateTerrainInfo(worldX, worldZ + 1).height; const heightSouth = calculateTerrainInfo(worldX, worldZ - 1).height; const heightEast = calculateTerrainInfo(worldX + 1, worldZ).height; const heightWest = calculateTerrainInfo(worldX - 1, worldZ).height; const maxSlope = Math.max(Math.abs(actualSurfaceY - heightNorth), Math.abs(actualSurfaceY - heightSouth), Math.abs(actualSurfaceY - heightEast), Math.abs(actualSurfaceY - heightWest)); if (maxSlope <= 2) { const treeHeightSeed = simpleHash(numericWorldSeed, worldX, actualSurfaceY, worldZ, 5); const randomTreeHeight = createMulberry32(treeHeightSeed); const treeHeight = treeHeightMin + Math.floor(randomTreeHeight() * (treeHeightMax - treeHeightMin + 1)); generateTreeStructure(worldX, actualSurfaceY + 1, worldZ, treeHeight, generatedBlocks); } } }
            }
        }
        const landminesPerChunk = 6;
        for (let i = 0; i < landminesPerChunk; i++) {
            const landmineX = chunkStartX + Math.floor(Math.random() * CHUNK_SIZE);
            const landmineZ = chunkStartZ + Math.floor(Math.random() * CHUNK_SIZE);
            const surfaceInfo = calculateTerrainInfo(landmineX, landmineZ);
            const surfaceY = surfaceInfo.height;
            const blockToReplace = getBlock(landmineX, surfaceY, landmineZ);
            if (blockToReplace && (blockToReplace.type === 'grass' || blockToReplace.type === 'dirt')) {
                internalAddBlock(landmineX, surfaceY, landmineZ, 'landmine', true);
                generatedBlocks[getBlockKey(landmineX, surfaceY, landmineZ)] = world[getBlockKey(landmineX, surfaceY, landmineZ)];
            }
        }
        // --- End of terrain generation logic ---

        // 2. SAVE the newly generated blocks to a file for persistence
        await saveChunkToFile(chunk.id, generatedBlocks);

        // 3. Load the new blocks into the active in-memory world cache
        // Note: internalAddBlock already added them, this just ensures consistency.
        Object.assign(world, generatedBlocks);

        // 4. Tell the client about these newly generated blocks
        socket.emit('chunkDataLoaded', {
            cx: chunk.cx,
            cz: chunk.cz,
            blocks: generatedBlocks
        });

        chunk.state = ChunkState.DataLoaded;
        chunksNeedUpdate = true;
    }
}
  function collectChunkBlocks(chunk) {
    const { wx: chunkStartX, wz: chunkStartZ } = chunkToWorldCoords(chunk.cx, chunk.cz);
    const chunkBlocks = {};
    const minYEstimate = -64; // Or your actual min Y
    const maxYEstimate = 128; // Or your actual max Y
    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const worldX = chunkStartX + x;
            const worldZ = chunkStartZ + z;
            for (let y = minYEstimate; y <= maxYEstimate; y++) { // Adjust Y range
                const blockKey = getBlockKey(worldX, y, worldZ);
                if (world[blockKey]) { // Check worker's world
                    chunkBlocks[blockKey] = world[blockKey];
                }
            }
        }
    }
    return chunkBlocks;
}
  // --- END: FULL REVISED generateChunkData FUNCTION ---
  // --- In chunkWorker.js ---

// Pass the main generatedBlocks map from generateChunkData
function generateTreeStructure(rX, rY, rZ, h, generatedBlocksMap) {

  for (let i = 0; i < h; i++) {
      const logKey = getBlockKey(rX, rY + i, rZ);
      internalAddBlock(rX, rY + i, rZ, "log"); // Updates global world
      // Ensure solid property is set in global world (might be redundant if internalAddBlock is perfect, but safe)
      world[logKey] = {type: "log", solid: true };
      // Add the confirmed data to the map PASSED IN
      generatedBlocksMap[logKey] = world[logKey];
      // console.log(`Worker TreeGen: Added log to MAIN generatedBlocks [${logKey}] =`, JSON.stringify(generatedBlocksMap[logKey]));
  }

  const lR = 2;
  const tTY = rY + h - 1;
  for (let ly = tTY - 1; ly <= tTY + 1; ly++) {
      for (let lx = -lR; lx <= lR; lx++) {
          for (let lz = -lR; lz <= lR; lz++) {
              const bX = rX + lx; const bY = ly; const bZ = rZ + lz;
              const leafKey = getBlockKey(bX, bY, bZ);
              // ... boundary/trunk checks ...
              if (!hasSolidBlock(bX, bY, bZ)) {
                  internalAddBlock(bX, bY, bZ, "leaves"); // Updates global world
                  // Ensure solid property is set (if leaves are solid)
                  world[leafKey] = {type: "leaves", solid: true }; // Change solid: false if leaves aren't solid
                  // Add the confirmed data to the map PASSED IN
                  generatedBlocksMap[leafKey] = world[leafKey];
                  // console.log(`Worker TreeGen: Added leaf to MAIN generatedBlocks [${leafKey}] =`, JSON.stringify(generatedBlocksMap[leafKey]));
              }
          }
      }
  }
  // Top leaf
  const topLeafKey = getBlockKey(rX, tTY + 2, rZ);
  if (!hasSolidBlock(rX, tTY + 2, rZ)) {
      internalAddBlock(rX, tTY + 2, rZ, "leaves");
      world[topLeafKey] = {type: "leaves", solid: true }; // Change solid: false if leaves aren't solid
      generatedBlocksMap[topLeafKey] = world[topLeafKey];
      // console.log(`Worker TreeGen: Added top leaf to MAIN generatedBlocks [${topLeafKey}] =`, JSON.stringify(generatedBlocksMap[topLeafKey]));
  }
}
  function addBlockInstanceFace(chunk, x, y, z, blockType, faceName) {
    const material = getMaterialIdentifierForBlockFace(blockType, faceName);
    const geo = faceGeometries[faceName];
    if (!material || !geo) return;
    const meshData = getChunkInstancedMesh(chunk, material, geo, faceName);
    if (!meshData) return;
    if (meshData.count < MAX_INSTANCES_PER_GEOMETRY_PER_CHUNK) {

      const targetMatrixArray = meshData.matrices;
      const offset = meshData.count * 16;

      dummy.position.set(x + 0.5, y + 0.5, z + 0.5);
      dummy.updateMatrix();
      dummy.matrix.toArray(targetMatrixArray, offset);
      meshData.count++;
    } else {
      console.warn(`Max instances reached for ${meshData.mesh.name}`);
    }
    }
    function getChunkInstancedMesh(chunk, material, faceGeometry, faceName) {
        if (!chunk || !material || !faceGeometry || !faceName) {
          console.error("Missing parameters for getChunkInstancedMesh");
          return null;
        }
        if (!chunk.meshes) {
          chunk.meshes = new Map();
        }
        const key = `${faceName}_${material}`;
        let meshData = chunk.meshes.get(key);
        if (!meshData) {
          meshData = {
            material: material,
            faceName: faceName,
            count: 0,
            matrices: [],
          };
          chunk.meshes.set(key, meshData);
        }
        return meshData;
    }
  function chunkToWorldCoords(chunkX, chunkZ) {
    return { wx: chunkX * CHUNK_SIZE, wz: chunkZ * CHUNK_SIZE };
    }
    function getMaterialForBlockFace(blockType, faceName) {
        const m = materials[blockType];
        if (!m) {
          console.warn(
            `No material found for block type: ${blockType}, using dirt.`
          );
          return materials.dirt.all;
        }
        if (m.all) return m.all;
        switch (faceName) {
          case "top":
            return m.top || m.side || m.all;
          case "bottom":
            return m.bottom || m.side || m.all;
          default:
            return m.side || m.top || m.all;
        }
        }
        function getBlock(x, y, z) {
            const key = getBlockKey(x, y, z);
            const data = world[key];
            // Return a copy including the key coordinates for convenience elsewhere
            return data ? { ...data, id: key, x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) } : undefined;
            }
            function getBlockKey(x, y, z) {
            return `${Math.floor(x)}_${Math.floor(y)}_${Math.floor(z)}`;
            }
            function hasSolidBlock(x, y, z) {
                const key = getBlockKey(x, y, z);
                return world[key]?.solid === true;
              }
              function hasBlock(x, y, z) {
                return world[getBlockKey(x, y, z)] !== undefined;
              }

    function internalAddBlock(worldX,worldY,worldZ,blockType,overwrite = false) {
        const blockKey = getBlockKey(worldX, worldY, worldZ);
        if (!overwrite && world[blockKey]) return;
        const isSolid = ["grass", "log", "dirt", "stone", "plank", "craftingtable", "leaves", "cobblestone", "coal_ore", "oxidized_iron_ore", "bedrock", "furnace", "landmine"].includes(
            blockType
        );
        world[blockKey] = { type: blockType, solid: isSolid };
    }

    function getChunk(x, z){
        const cx = Math.floor(x / CHUNK_SIZE);
        const cz = Math.floor(z / CHUNK_SIZE);
        return chunks.get(`${cx}_${cz}`);
    }

    // --- In chunkWorker.js ---

// Ensure these constants and helper functions are defined globally in the worker:
// const simplex = new SimplexNoise(WORLD_SEED);
// const CHUNK_SIZE = 16;
// const BiomeType = { Plains: 0, Forest: 1, Mountain: 2, River: 3 };
// const biomeParameters = { ... your full definition ... };
// const biomeNoiseScale, biomeOctaves, biomePersistence, biomeLacunarity;
// const forestThreshold, mountainThreshold;
// const FRACTAL_OCTAVES, FRACTAL_PERSISTENCE, FRACTAL_LACUNARITY; // Default fractal params
// function generateFractalNoise2D(...) - should be defined

// Helper for smooth interpolation (Hermite interpolation)
function smoothStep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

// Helper function to calculate height for a given set of biome parameters
// It's better if this function uses a shared base noise, but for simplicity
// in this example, it recalculates noise based on params.terrainScale.
// For optimal blending, ensure params1.terrainScale and params2.terrainScale are not wildly different,
// or refactor to use a single underlying noise for the height base.
function getHeightForBiomeParams(params, worldX, worldZ, baseLacunarity) {
    const terrainOctaves = params.terrainOctaves || FRACTAL_OCTAVES;
    const terrainPersistence = params.terrainPersistence || FRACTAL_PERSISTENCE;
    const terrainLacunarity = baseLacunarity || FRACTAL_LACUNARITY; // Use passed or default

    const heightNoise = generateFractalNoise2D(
        simplex,
        worldX * params.terrainScale,
        worldZ * params.terrainScale,
        terrainOctaves,
        terrainPersistence,
        terrainLacunarity
    );
    const normalizedHeightNoise = (heightNoise + 1) / 2.0; // Normalize to 0-1
    let heightValue = params.baseHeight + (normalizedHeightNoise * params.terrainAmplitude);

    // Add biome-specific hill layers if they exist (like for your enhanced Plains)
    if (params.hillAmplitude && params.hillScale) {
        const hillOctaves = params.hillOctaves || 3;
        const hillPersistence = params.hillPersistence || 0.5;
        const largeHillNoise = generateFractalNoise2D(
            simplex,
            worldX * params.hillScale,
            worldZ * params.hillScale,
            hillOctaves,
            hillPersistence,
            terrainLacunarity // Can reuse
        );
        heightValue += ((largeHillNoise + 1) / 2.0) * params.hillAmplitude;
    }

    // Add biome-specific roughness
    if (typeof params.roughnessAmplitude !== 'undefined' && typeof params.roughnessScale !== 'undefined') {
        heightValue += simplex.noise2D(worldX * params.roughnessScale, worldZ * params.roughnessScale) * params.roughnessAmplitude;
    }
    return heightValue;
}


// --- FULL calculateTerrainInfo FUNCTION with Blending ---
function calculateTerrainInfo(worldX, worldZ) {
    // 1. Determine Biome Influence using a continuous noise value
    const rawBiomeNoiseValue = generateFractalNoise2D(
        simplex,
        worldX * biomeNoiseScale,
        worldZ * biomeNoiseScale,
        biomeOctaves,
        biomePersistence,
        biomeLacunarity
    );
    const normalizedBiomeNoise = (rawBiomeNoiseValue + 1) / 2.0; // Normalized to 0-1

    // Define the width of the transition zone (as a fraction of the 0-1 noise range)
    const TRANSITION_ZONE_WIDTH = 0.15; // e.g., 15% of noise range for blending

    let primaryBiome, secondaryBiome;
    let weightPrimary = 1.0, weightSecondary = 0.0;
    let dominantParams; // Parameters of the biome that will dictate features like surface block

    // Determine primary and secondary biomes and their weights
    if (normalizedBiomeNoise < forestThreshold) { // Likely Plains or transitioning to/from Plains
        primaryBiome = BiomeType.Plains;
        dominantParams = biomeParameters[BiomeType.Plains];
        if (normalizedBiomeNoise > forestThreshold - TRANSITION_ZONE_WIDTH) { // Transitioning from Plains to Forest
            secondaryBiome = BiomeType.Forest;
            const progressIntoForest = (normalizedBiomeNoise - (forestThreshold - TRANSITION_ZONE_WIDTH)) / TRANSITION_ZONE_WIDTH;
            weightSecondary = smoothStep(0, 1, progressIntoForest);
            weightPrimary = 1.0 - weightSecondary;
        }
    } else if (normalizedBiomeNoise < mountainThreshold) { // Likely Forest or transitioning
        primaryBiome = BiomeType.Forest;
        dominantParams = biomeParameters[BiomeType.Forest];
        if (normalizedBiomeNoise < forestThreshold + TRANSITION_ZONE_WIDTH) { // Transitioning from Plains to Forest
            secondaryBiome = BiomeType.Plains;
            const progressIntoPlains = ((forestThreshold + TRANSITION_ZONE_WIDTH) - normalizedBiomeNoise) / TRANSITION_ZONE_WIDTH;
            weightSecondary = smoothStep(0, 1, progressIntoPlains);
            weightPrimary = 1.0 - weightSecondary;
        } else if (normalizedBiomeNoise > mountainThreshold - TRANSITION_ZONE_WIDTH) { // Transitioning from Forest to Mountain
            secondaryBiome = BiomeType.Mountain;
            const progressIntoMountain = (normalizedBiomeNoise - (mountainThreshold - TRANSITION_ZONE_WIDTH)) / TRANSITION_ZONE_WIDTH;
            weightSecondary = smoothStep(0, 1, progressIntoMountain);
            weightPrimary = 1.0 - weightSecondary;
        }
    } else { // Likely Mountain or transitioning from Forest
        primaryBiome = BiomeType.Mountain;
        dominantParams = biomeParameters[BiomeType.Mountain];
        if (normalizedBiomeNoise < mountainThreshold + TRANSITION_ZONE_WIDTH) { // Transitioning from Forest to Mountain
            secondaryBiome = BiomeType.Forest;
            const progressIntoForest = ((mountainThreshold + TRANSITION_ZONE_WIDTH) - normalizedBiomeNoise) / TRANSITION_ZONE_WIDTH;
            weightSecondary = smoothStep(0, 1, progressIntoForest);
            weightPrimary = 1.0 - weightSecondary;
        }
    }

    // Get parameters for the primary and (if applicable) secondary biomes
    const paramsPrimary = biomeParameters[primaryBiome];
    const paramsSecondary = secondaryBiome !== undefined ? biomeParameters[secondaryBiome] : null;

    // 2. Calculate height based on primary biome
    let finalHeightValue = getHeightForBiomeParams(paramsPrimary, worldX, worldZ, paramsPrimary.terrainLacunarity || FRACTAL_LACUNARITY);

    // 3. If there's a secondary biome influence, blend its height
    if (paramsSecondary && weightSecondary > 0.001) { // Only blend if significant weight
        const heightSecondary = getHeightForBiomeParams(paramsSecondary, worldX, worldZ, paramsSecondary.terrainLacunarity || FRACTAL_LACUNARITY);
        finalHeightValue = (finalHeightValue * weightPrimary) + (heightSecondary * weightSecondary);
    }

    const finalTerrainHeight = Math.floor(finalHeightValue);

    // The 'biome' and 'params' returned will be for the dominant biome,
    // which dictates surface type, tree types, etc. The height is blended.
    return {
        height: finalTerrainHeight,
        biome: primaryBiome, // Or decide dominant based on highest weight if more complex
        params: paramsPrimary, // Corresponds to the chosen 'biome'
    };
}
      const simplex = new SimplexNoise(WORLD_SEED);

      // --- Default Fractal Noise Parameters ---
      // Can be overridden by biome settings if needed
      const FRACTAL_OCTAVES = 6;
      const FRACTAL_PERSISTENCE = 0.5;
      const FRACTAL_LACUNARITY = 2.0;

      // --- BIOME DEFS (Update parameters as needed, e.g., higher mountain base/amplitude) ---
      const BiomeType = { Plains: 0, Forest: 1, Mountain: 2, River: 3 };
      const biomeParameters = {
        // biomeParameters in chunkWorker.js
        [BiomeType.Plains]: {
          name: "Plains",
          baseHeight: 3,
          // Parameters for the base, smooth terrain of the plains
          terrainAmplitude: 3,     // Lower amplitude for smoother base
          terrainScale: 0.06,      // Larger scale for very gentle base variations
          terrainOctaves: 3,         // Fewer octaves for smoother base
          terrainPersistence: 0.45,  // Lower persistence for smoother base
  
          // Parameters for the large, rolling hills on top
          hillAmplitude: 15,       // How tall the big hills can be (added to baseHeight + base terrain)
          hillScale: 0.008,        // Much smaller scale for very large, broad hills
          hillOctaves: 4,          // A few octaves for some shape to the large hills
          hillPersistence: 0.5,
  
          // Other plains parameters (trees, surface blocks, etc.)
          treeDensity: 0.005, treeHeightMin: 3, treeHeightMax: 5, // Adjust as needed
          surfaceBlock: "grass", underSurfaceBlock: "dirt", dirtDepth: 3,
          stoneLevelModifier: -10, plainsForestPatchChance: 0.03, plainsForestPatchDensity: 0.05,
      },[BiomeType.Forest]: {
          name: "Forest", baseHeight: 3, terrainAmplitude: 20, terrainScale: 0.03,
          treeDensity: 0.04, treeHeightMin: 4, treeHeightMax: 7,
          surfaceBlock: "grass", underSurfaceBlock: "dirt", dirtDepth: 4,
          stoneLevelModifier: -8,
          terrainOctaves: 1
        },
        [BiomeType.Mountain]: {
          name: "Mountain", baseHeight: 20, // Higher base for mountains
          terrainAmplitude: 10, // Increased amplitude for mountains
          terrainScale: 0.02, // Slightly larger features for mountains
          treeDensity: 0.005, treeHeightMin: 3, treeHeightMax: 5,
          surfaceBlock: "grass",
          underSurfaceBlock: "stone", dirtDepth: 3, stoneLevelModifier: 0,
          snowLevel: 55, // Snow line
          terrainOctaves: 2, // More detail for mountains
          terrainPersistence: 0.55, // More ruggedness
          terrainLacunarity: 2.1, // Slightly faster detail increase
          roughnessAmplitude: 1, // More roughness for mountains
        },
        [BiomeType.River]: {
          name: "River", baseHeight: 1, terrainAmplitude: 3, terrainScale: 0.04,
          treeDensity: 0.003, treeHeightMin: 3, treeHeightMax: 5,
          surfaceBlock: "water", underSurfaceBlock: "dirt", dirtDepth: 3,
          stoneLevelModifier: -10, plainsForestPatchChance: 0.03, plainsForestPatchDensity: 0.05,
          // Optional: Override fractal params for this biome's heightmap if desired
          terrainOctaves: 0.2, terrainPersistence: 0.45,
        },
      };

      // --- Biome Determination (UPDATED) ---
      const biomeNoiseScale = 0.0025;
      const biomeOctaves = 4; // Fewer octaves for broad biome map
      const biomePersistence = 0.5;
      const biomeLacunarity = 2.0;
      const forestThreshold = 0.4; // Thresholds remain in [0, 1] range
      const mountainThreshold = 0.5; // Thresholds remain in [0, 1] range

            // --- START: ADD Cave/River Noise Parameters ---
            const CAVE_SEED_OFFSET = 10000; // Use different offsets for different noise types
      const RIVER_SEED_OFFSET = 20000;

      // Cave Settings
      const caveNoiseScale = 0.06;   // Controls the size/frequency of cave systems
      const caveThreshold = 0.65;  // Noise value > threshold = air. Higher = smaller/rarer caves (Range 0-1)
      const minCaveY = -60;        // Deepest caves can start
      const maxCaveY = 40;         // Caves generally don't go much above this Y level

      function getBiome(worldX, worldZ) {
          const noiseValue = generateFractalNoise2D( // Use fractal noise for biomes
              simplex, // Use the simplex instance
              worldX * biomeNoiseScale,
              worldZ * biomeNoiseScale,
              biomeOctaves,
              biomePersistence,
              biomeLacunarity
          ); // Output: approx [-1, 1]

          // Normalize noise to [0, 1] range for comparison with original thresholds
          const normalizedNoise = (noiseValue + 1) / 2.0;

          if (normalizedNoise < forestThreshold) return BiomeType.Plains;
          else if (normalizedNoise > mountainThreshold) return BiomeType.Mountain;
          else return BiomeType.Forest;
      }

      function getCave(worldX, worldZ, worldY) {
         const noiseValue = generateFractalNoise3dD(
            simplex,
            worldX * biomeNoiseScale,
            worldY * biomeNoiseScale,
            worldZ * biomeNoiseScale,
            biomeOctaves,
            biomePersistence,
            biomeLacunarity
         )
        const normalizedNoise = (noiseValue + 1) / 2.0;

        if (normalizedNoise > 0.5) return true;
        else return false;
      }
      function removeBlockAt(x, y, z) {
        const chunk = getChunk(x, z);
        const blockKey = getBlockKey(x, y, z);
        const blockData = world[blockKey];
        if (!blockData) return false;

        const blockType = blockData.type;
        let dropType = blockType;
        if (blockType === 'stone') {
            dropType = 'cobblestone';
        } else if (blockType === 'grass') {
            dropType = 'dirt';
        }

        // Check if it's a leaf block - low chance of dropping sapling or stick? (Future enhancement)
        // For now, leaves drop nothing to avoid clutter

        if(blockType !== 'water')delete world[blockKey]; // Remove block from world data
        socket.emit('removeBlockWorker', { x, y, z })
        return true;
      }
            // REMOVE 'updateWorld' handler
            // case 'updateWorld':
            //    world = data;
            //    break;
    
            socket.on('addBlockWorker', async (data) => {
    const { x, y, z, type } = data;
    const chunkId = getChunkId(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));

    // 1. Load the chunk data from the file
    let chunkObject = await loadChunkFromFile(chunkId);
    if (!chunkObject) {
        console.error(`Cannot add block: Chunk file ${chunkId} does not exist!`);
        return;
    }

    // 2. Modify the data
    const blockKey = getBlockKey(x, y, z);
    const isSolid = ["grass", "log", "dirt", "stone", "plank", "craftingtable", "leaves", "cobblestone", "coal_ore", "oxidized_iron_ore", "bedrock", "furnace", "landmine"].includes(type);
    chunkObject[blockKey] = { type: type, solid: isSolid };
    world[blockKey] = { type: type, solid: isSolid }; // Also update the in-memory cache

    // 3. Save the updated chunk data back to the file
    await saveChunkToFile(chunkId, chunkObject);

    // 4. Client remesh is handled separately by the client's logic
});

socket.on('removeBlockWorker', async (data) => {
    const { x, y, z } = data;
    const chunkId = getChunkId(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));

    // 1. Load the chunk data
    let chunkObject = await loadChunkFromFile(chunkId);
    if (!chunkObject) {
        console.error(`Cannot remove block: Chunk file ${chunkId} does not exist!`);
        return;
    }

    // 2. Modify the data
    const blockKey = getBlockKey(x, y, z);
    if (chunkObject[blockKey]) {
        delete chunkObject[blockKey];
        if(world[blockKey]) delete world[blockKey]; // Also update in-memory cache
    }

    // 3. Save the updated data
    await saveChunkToFile(chunkId, chunkObject);
});
    
            socket.on('generateChunkData', (data) => {
                 // console.log(`Worker: Received generateChunkData for ${data.id}`); // Debug
                 if (!chunks.has(data.id)) {
                     chunks.set(data.id, { ...data, state: ChunkState.Unknown });
                 }
                 // generateChunkData updates the worker's 'world' internally now
                 generateChunkData(chunks.get(data.id));
                })
    
            socket.on('remeshChunks', (data) => {
                 // console.log("Worker: Received remesh request for chunks:", data); // Debug
                 if (data && Array.isArray(data)) {
                     data.forEach(chunkId => {
                         const chunk = chunks.get(chunkId);
                         // Check state before marking (Keep this logic)
                          if (chunk &&
                             chunk.state !== ChunkState.Unknown &&
                             chunk.state !== ChunkState.LoadingData &&
                             chunk.state !== ChunkState.Meshing &&
                             chunk.state !== ChunkState.NeedsRemesh)
                         {
                             // console.log(`Worker: Marking chunk ${chunkId} (State: ${chunk.state}) for remesh.`); // Debug
                             chunk.state = ChunkState.NeedsRemesh;
                             chunksNeedUpdate = true;
                         }
                     });
                 }
                })
             socket.on( 'disposeChunk', (data) => {
                 // console.log("Worker: Disposing chunk", data.chunkId); // Debug
                 chunks.delete(data.chunkId);
                 console.log("chunk unloaded")
                 // We might need to remove blocks associated with this chunk
                 // from the worker's 'world' object to prevent memory leaks,
                 // but this is more complex. For now, just remove the chunk ref.
             })
    
             socket.on('processUpdates', () => {
                  chunksNeedUpdate = true;
             })
             socket.on('updateCameraPosition', (data) => {
                  camera.position = data;
            });
             socket.on('updateChunks', () => {
                chunksNeedUpdate = true;
                updateChunks();
            });
             socket.on('chunksNeedUpdate', () => {
                chunksNeedUpdate = true;
                updateChunks()
            });
             socket.on("reMeshAndRemove", (data) => {
                const chunk = chunks.get(data);
                if (chunk) {
                    chunk.state = ChunkState.NeedsRemesh;
                    meshChunk(chunk);
                    socket.emit("disposeChunkMesh", chunk.id);
                } else {
                    console.warn("Worker: Chunk not found for reMesh:", data.chunkId);
                }
              });    
             socket.on("loadWorld", (data) => {
                world = data;
                updateChunks();
              });
            socket.on('removeBlockWorker', (data) => {
              const blockKey = getBlockKey(data.x, data.y, data.z);
              if (world[blockKey]) {
                 delete world[blockKey]; // Delete the block from the worker's world
              }
            });
    })
    const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});