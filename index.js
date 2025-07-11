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
const THREE = require("three");
const {
  SimplexNoise,
  generateFractalNoise2D,
  generateFractalNoise3D,
  createMulberry32,
  simpleHash,
  WORLD_SEED,
  numericWorldSeed,
} = require("./simplexNoise.js");

const express = require("express");
const http = require("http");
const app = express();
const server = http.createServer(app);
const { Server } = require("socket.io");
const fs = require("fs").promises;
const path = require("path");
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});
const { Worker } = require("worker_threads");
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/overworld.html");
});
app.get("/three.js", (req, res) => {
  res.sendFile(__dirname + "/three.js");
});
app.get("/breaking.js", (req, res) => {
  res.sendFile(__dirname + "/breaking.js");
});
app.get("/heldItem.js", (req, res) => {
  res.sendFile(__dirname + "/heldItem.js");
});
app.get("/db.js", (req, res) => {
  res.sendFile(__dirname + "/db.js");
});
app.get("/mobs.js", (req, res) => {
  res.sendFile(__dirname + "/mobs.js");
});
app.get("/GLTFLoader.js", (req, res) => {
  res.sendFile(__dirname + "/GLTFLoader.js");
});
app.get("holdItemAnimation.js", (req, res) => {
  res.sendFile(__dirname + "/holdItemAnimation.js");
});
app.use("/textures", express.static(__dirname + "/textures"));

let camera = {
  position: { x: 0, y: 0, z: 0 },
};
const CHUNK_SIZE = 16;
const faceGeometries = {};
const RENDER_DISTANCE = 2;
const MAX_INSTANCES_PER_GEOMETRY_PER_CHUNK = 100000;
const dummy = new THREE.Object3D();
let chunksNeedUpdate = true;
let scene;
let world = {};
let chunks = new Map();
let currentDimension = "overworld";
let generationId = 0;
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
function getBlockKey(x, y, z) {
  return `${Math.floor(x)}_${Math.floor(y)}_${Math.floor(z)}`;
}

const worldDirectory = path.join(__dirname, "world");

// Function to ensure the world directory exists when the server starts
async function setupWorldDirectory() {
  try {
    await fs.mkdir(worldDirectory);
    console.log(`Created world directory at: ${worldDirectory}`);
  } catch (error) {
    if (error.code === "EEXIST") {
      console.log("World directory already exists.");
    } else {
      console.error("Error creating world directory:", error);
    }
  }
}
function chunkToWorldCoords(chunkX, chunkZ) {
  return { wx: chunkX * CHUNK_SIZE, wz: chunkZ * CHUNK_SIZE };
}
function removeChunkBlocksFromServerMemory(chunk) {
  if (!chunk) return;
  let blocksDeleted = 0;
  const { wx: chunkStartX, wz: chunkStartZ } = chunkToWorldCoords(
    chunk.cx,
    chunk.cz
  );

  // Use full possible block range
  const MIN_Y = -100; // Extended lower bound
  const MAX_Y = 200; // Extended upper bound

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let y = MIN_Y; y <= MAX_Y; y++) {
        const blockKey = getBlockKey(chunkStartX + x, y, chunkStartZ + z);
        delete world[blockKey]; // Delete regardless of existence
        blocksDeleted++;
      }
    }
  }
  console.log(blocksDeleted);
  console.log(
    `[Server] World object size: ${Object.keys(world).length} blocks.`
  );
}
setupWorldDirectory();

// This function uses async/await to reliably clear the world folder.
async function clearWorldFolder() {
  const worldFolder = path.join(__dirname, "world");
  try {
    const files = await fs.readdir(worldFolder);
    const unlinkPromises = files.map((file) =>
      fs.unlink(path.join(worldFolder, file))
    );
    await Promise.all(unlinkPromises);
    console.log("[Server] All previous world files deleted successfully.");
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("Error clearing world folder:", err);
    }
  }
}

io.on("connection", async (socket) => {
  // Make the handler async
  console.log("A user connected. Resetting world and chunks for new session.");
  world = {};
  chunks.clear();
  await clearWorldFolder();
  console.log("World and chunks cleared for new session.");
  chunksNeedUpdate = true;
  updateChunks();

  if (socket.conn.transport.socket && socket.conn.transport.setNoDelay) {
    socket.conn.transport.socket.setNoDelay(true);
  } else {
    console.log("socket.conn.transport.socket is unavailable");
  }

  currentDimension = "overworld";

  const activeMobs = new Map();
    const MOB_ATTACK_RANGE = 15;
    const MOB_SHOT_COOLDOWN = 2000; // 2 seconds
    const MOB_TICK_RATE = 100; // 10 times per second

    function hasLineOfSight(start, end, world, maxDist) {
    const direction = new THREE.Vector3().subVectors(end, start);
    const distance = direction.length();

    if (distance > maxDist) {
        return false;
    }

    direction.normalize();

    const step = 0.5; // Raycasting step size
    for (let d = step; d < distance; d += step) {
        const p = start.clone().add(direction.clone().multiplyScalar(d));
        const key = getBlockKey(p.x, p.y, p.z);
        if (world[key] && world[key].solid) {
            return false; // Hit a solid block
        }
    }
    return true; // No obstructions
}

    const mobTickInterval = setInterval(() => {
    const playerPos = camera.position;
    const playerPosVec = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z);

    activeMobs.forEach(mob => {
        const mobPos = new THREE.Vector3(mob.position.x, mob.position.y, mob.position.z);
        
        // First check distance, it's cheaper than raycasting
        if (mobPos.distanceTo(playerPosVec) < MOB_ATTACK_RANGE) {
            
            // Now perform the line of sight check
            if (hasLineOfSight(mobPos, playerPosVec, world, MOB_ATTACK_RANGE)) {
                mob.timeSinceLastShot += MOB_TICK_RATE;
                if (mob.timeSinceLastShot >= MOB_SHOT_COOLDOWN) {
                    mob.timeSinceLastShot = 0;

                    // Calculate direction for knockback
                    const direction = new THREE.Vector3().subVectors(playerPosVec, mobPos).normalize();

                    // Tell the client to render a projectile
                    socket.emit('fireProjectile', {
                        mobId: mob.id,
                        start: mob.position,
                        end: { x: playerPos.x, y: playerPos.y, z: playerPos.z }
                    });

                    // Server determines the hit and tells the player they took damage
                    // We add a small delay to simulate travel time
                    setTimeout(() => {
                        socket.emit('playerHit', { 
                            damage: 1, 
                            source: 'turret',
                            direction: { x: direction.x, y: direction.y, z: direction.z } // Send knockback direction
                        });
                    }, 300); // 300ms projectile travel time
                }
            }
        }
    });
}, MOB_TICK_RATE);

    socket.on("teleportToSpace", async () => {
    console.log("[Server] Received teleport to space request.");

    // 1. Change the dimension state
    currentDimension = "space";
    generationId++; // Invalidate any pending chunk generations from the old dimension
    workers.forEach(workerInfo => workerInfo.worker.postMessage({ type: "generationId", dimension: generationId }));

    // 2. Clear all server-side world data to force a full regeneration
    world = {};
    chunks.clear();
    await clearWorldFolder(); // WIPE saved world files for a fresh start

    // 3. Reset the player's logical position on the server for the new dimension
    camera.position.x = 0;
    camera.position.y = 80; // Start high up in space
    camera.position.z = 0;

    console.log(
      `[Server] Dimension set to '${currentDimension}'. World cleared. Forcing client state.`
    );

    // 4. Command the client to reset its state and move the player
    // The client, upon receiving this, will clear its own world and then
    // send a fresh 'updateChunks' request for the new location.
    socket.emit("forcePlayerState", {
      dimension: "space",
      position: camera.position,
    });
  });

  socket.on('hitMob', (mobId) => {
    const mob = activeMobs.get(mobId);
    if (mob) {
        mob.health -= 1;
        console.log(`Mob ${mobId} hit. Health is now ${mob.health}`);

        if (mob.health <= 0) {
            activeMobs.delete(mobId);
            console.log(`Mob ${mobId} died.`);
            // Use io.emit to tell all clients the mob is gone
            io.emit('mobDied', mobId);
        }
    }
});

  socket.on("disconnect", () => {
    world = {};
    chunks.clear();
    clearWorldFolder().then(() => {
      console.log("World and chunks cleared for new session.");
      chunksNeedUpdate = true;
      updateChunks();
    });
  });

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
  function meshChunk(chunk) {
    console.log("meshChunk called!")
    if (
      !chunk ||
      chunk.state === ChunkState.LoadingData ||
      chunk.state === ChunkState.Unknown
    ) {
      console.warn(
        `Worker: Attempted meshChunk for ${chunk?.id} while state is ${chunk?.state}. Aborting.`
      );
      return;
    }
    if (!world || Object.keys(world).length === 0) {
      console.warn(
        `Worker: Attempted meshChunk for ${chunk.id} but worker world data is empty. Aborting.`
      );
      return;
    }

    chunk.meshes = new Map();
    const { wx: sX, wz: sZ } = chunkToWorldCoords(chunk.cx, chunk.cz);
    let facesAdded = 0;
    const faces = [
      { face: "right", dx: 1, dy: 0, dz: 0 },
      { face: "left", dx: -1, dy: 0, dz: 0 },
      { face: "top", dx: 0, dy: 1, dz: 0 },
      { face: "bottom", dx: 0, dy: -1, dz: 0 },
      { face: "front", dx: 0, dy: 0, dz: 1 },
      { face: "back", dx: 0, dy: 0, dz: -1 },
    ];
    const minBY = -64;
    const maxBY = 128;

    // This is the new optimization loop
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        // First, scan this (x, z) column to find the min and max Y with blocks.
        // This avoids iterating through huge vertical sections of empty air.
        let colMinY = maxBY;
        let colMaxY = minBY;
        for (let yCheck = minBY; yCheck <= maxBY; yCheck++) {
          if (hasBlock(sX + x, yCheck, sZ + z)) {
            colMinY = Math.min(colMinY, yCheck);
            colMaxY = Math.max(colMaxY, yCheck);
          }
        }

        // If the column is entirely empty, we can skip it.
        if (colMinY > colMaxY) {
          continue;
        }

        // Now, loop only within the range where blocks actually exist for this column.
        // We add a +/- 1 buffer to check for faces adjacent to air.
        const yStart = Math.max(minBY, colMinY - 1);
        const yEnd = Math.min(maxBY, colMaxY + 1);

        for (let y = yStart; y <= yEnd; y++) {
          const blockCoordX = sX + x;
          const blockCoordY = y;
          const blockCoordZ = sZ + z;
          const bD = getBlock(blockCoordX, blockCoordY, blockCoordZ);

          if (bD) {
            if (typeof bD.type === "undefined") {
              console.error(
                `Worker: MeshChunk Loop - Block at ${blockCoordX},${blockCoordY},${blockCoordZ} has undefined type! Skipping. BD:`,
                JSON.stringify(bD)
              );
              continue;
            }

            const isCurrentBlockSolid = bD.solid === true;

            faces.forEach((faceDirection) => {
              const nX = blockCoordX + faceDirection.dx;
              const nY = blockCoordY + faceDirection.dy;
              const nZ = blockCoordZ + faceDirection.dz;
              const nB = getBlock(nX, nY, nZ);
              let shouldRenderFace = false;

              if (!nB) {
                shouldRenderFace = true;
              } else {
                const isNeighborSolid = nB.solid === true;
                if (isCurrentBlockSolid && !isNeighborSolid) {
                  shouldRenderFace = true;
                } else if (!isCurrentBlockSolid && !isNeighborSolid) {
                  if (bD.type !== nB.type) {
                    shouldRenderFace = true;
                  }
                } else if (!isCurrentBlockSolid && isNeighborSolid) {
                  shouldRenderFace = true;
                }
              }

              if (shouldRenderFace) {
                addBlockInstanceFace(
                  chunk,
                  blockCoordX,
                  blockCoordY,
                  blockCoordZ,
                  bD.type,
                  faceDirection.face
                );
                facesAdded++;
              }
            });
          }
        } // End y loop
      } // End z loop
    } // End x loop

    // --- Consolidate and Send Data ---
    const meshDataArray = [];
    chunk.meshes.forEach((meshData) => {
      if (meshData.count > 0) {
        const matricesArray = new Float32Array(meshData.matrices);
        meshDataArray.push({
          materialIdentifier: meshData.material,
          faceName: meshData.faceName,
          matrices: matricesArray.buffer,
          count: meshData.count,
        });
      }
    });

    try {
      if (meshDataArray.length > 0) {
        const transferables = meshDataArray.map((data) => data.matrices);
        socket.emit(
          "chunkMeshData",
          { chunkId: chunk.id, meshDataArray: meshDataArray },
          transferables
        );
        console.log("chunkMesh sent")
      } else {
        socket.emit("chunkMeshEmpty", { chunkId: chunk.id });
      }
      chunk.state = ChunkState.Active;
    } catch (postError) {
      console.error(
        `Server: Error posting mesh message for chunk ${chunk.id}:`,
        postError
      );
      chunk.state = ChunkState.DataLoaded;
    }
  }
  function getMaterialIdentifierForBlockFace(blockType, faceName) {
    // ... (return 'grass_top', 'stone_all', etc. based on type/face)
    // (Copy the implementation from the previous answer)
    if (blockType === "grass") {
      if (faceName === "top") return "grass_top";
      if (faceName === "bottom") return "grass_bottom";
      return "grass_side";
    }
    if (blockType === "log") {
      if (faceName === "top" || faceName === "bottom") return "log_top";
      return "log_side";
    }
    if (blockType === "leaves") return "leaves_all";
    if (blockType === "dirt") return "dirt_all";
    if (blockType === "stone") return "stone_all";
    if (blockType === "plank") return "plank_all";
    if (blockType === "craftingtable") {
      if (faceName === "top") return "craftingtable_top";
      if (faceName === "bottom") return "craftingtable_bottom";
      return "craftingtable_side";
    }
    if (blockType === "cobblestone") return "cobblestone_all";
    if (blockType === "coal_ore") return "coal_ore_all";
    if (blockType === "oxidized_iron_ore") return "oxidized_iron_ore_all";
    if (blockType === "water") return "water_all";
    if (blockType === "bedrock") return "bedrock_all";
    if (blockType === "cave_air") return "cave_air_all";
    if (blockType === "air") return "air_all";
    if (blockType == "furnace") {
      if (faceName == "front") return "furnace_front";
      if (faceName == "top") return "furnace_top";
      if (faceName == "bottom") return "furnace_bottom";
      return "furnace_side";
    }
    if (blockType === "landmine") return "landmine_all";

    console.warn(
      `No material identifier found for block type: ${blockType}, face: ${faceName}`
    );
    return "dirt_all"; // Fallback
  }

  function updateChunks() {
    const desired = new Set();
    if (!chunksNeedUpdate) return;
    chunksNeedUpdate = false;

    const { cx: pCX, cz: pCZ } = worldToChunkCoords(
      camera.position.x,
      camera.position.z
    );

    const playerChunkId = getChunkId(pCX, pCZ);
    const playerChunk = chunks.get(playerChunkId);

    // --- 1. HIGH PRIORITY PASS: Handle the player's current chunk first ---
    if (playerChunk) {
      if (playerChunk.state === ChunkState.DataLoaded || playerChunk.state === ChunkState.NeedsRemesh) {
        playerChunk.state = ChunkState.Meshing;
        setTimeout(() => {
          try {
            meshChunk(playerChunk);
          } catch (e) {
            console.error(`Error during priority mesh for chunk ${playerChunkId}:`, e);
            const chunkToUpdate = chunks.get(playerChunkId);
            if (chunkToUpdate) {
              chunkToUpdate.state = ChunkState.DataLoaded;
            }
          }
        }, 0);
      }
    }


    // --- 2. NORMAL PRIORITY PASS: Handle all other chunks ---
    for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
      for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
        const cId = getChunkId(pCX + dx, pCZ + dz);
        desired.add(cId);

        // *** THE BUG WAS HERE: The 'if (cId === playerChunkId) continue;' check was here, skipping everything. ***

        const tCX = pCX + dx;
        const tCZ = pCZ + dz;
        let ch = chunks.get(cId);

        if (!ch) {
          ch = { id: cId, cx: tCX, cz: tCZ, state: ChunkState.Unknown };
          chunks.set(cId, ch);
        }

        if (ch.state === ChunkState.Unknown) {
          ch.state = ChunkState.LoadingData;
          // This will now correctly run for the player's chunk if it's new.
          generateChunkData(ch); // This is our smart dispatcher
          chunksNeedUpdate = true;
        } else if (
          ch.state === ChunkState.DataLoaded ||
          ch.state === ChunkState.NeedsRemesh
        ) {
          // *** THE FIX IS HERE: We only skip the player's chunk if it's ready for meshing,
          // because we know the priority pass already handled it. ***
          if (cId === playerChunkId) {
            continue;
          }
          
          ch.state = ChunkState.Meshing;
          setTimeout(() => {
            try {
              meshChunk(ch);
            } catch (e) {
              console.error(`Error during scheduled mesh for chunk ${cId}:`, e);
              const chunkToUpdate = chunks.get(cId);
              if (chunkToUpdate) {
                chunkToUpdate.state = ChunkState.DataLoaded;
              }
            }
          }, 0);
        } else if (ch.state === ChunkState.Inactive) {
          ch.state = ChunkState.NeedsRemesh;
          chunksNeedUpdate = true;
        }
      }
    }

    // Unloading logic remains unchanged
    chunks.forEach((ch, cId) => {
      if (!desired.has(cId) && ch.state !== ChunkState.LoadingData) {
        workers.forEach(workerInfo => {
            workerInfo.worker.postMessage({ type: 'unloadChunk', cx: ch.cx, cz: ch.cz });
        });
        removeChunkBlocksFromServerMemory(ch);
        socket.emit("disposeChunkMesh", cId);
        chunks.delete(cId);
      }
    });
  }
async function generateChunkData(chunk) {
    if (!chunk) {
      console.error(
        "Server: generateChunkData called with undefined chunk object!"
      );
      return;
    }

    const loadedBlocks = await loadChunkFromFile(chunk.id);

    if (loadedBlocks) {
      Object.assign(world, loadedBlocks);
      socket.emit("chunkDataLoaded", {
        cx: chunk.cx,
        cz: chunk.cz,
        blocks: loadedBlocks,
      });
      chunk.state = ChunkState.DataLoaded; // Corrected state
      chunksNeedUpdate = true;
    } else {
      const taskDimension = currentDimension;
      const taskGenerationId = generationId; // Capture the generation ID

      const currentChunk = chunks.get(chunk.id);
      if (!currentChunk) {
        return;
      }
      
      // Pass the captured generation ID to the dispatcher
      dispatchChunkGenerationToWorker(currentChunk, taskDimension, taskGenerationId);
    }
  }
  // Pass the main generatedBlocks map from generateChunkData
  function generateTreeStructure(rX, rY, rZ, h, generatedBlocksMap) {
    for (let i = 0; i < h; i++) {
      const logKey = getBlockKey(rX, rY + i, rZ);
      internalAddBlock(rX, rY + i, rZ, "log"); // Updates global world
      // Ensure solid property is set in global world (might be redundant if internalAddBlock is perfect, but safe)
      world[logKey] = { type: "log", solid: true };
      // Add the confirmed data to the map PASSED IN
      generatedBlocksMap[logKey] = world[logKey];
      // console.log(`Worker TreeGen: Added log to MAIN generatedBlocks [${logKey}] =`, JSON.stringify(generatedBlocksMap[logKey]));
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
          // ... boundary/trunk checks ...
          if (!hasSolidBlock(bX, bY, bZ)) {
            internalAddBlock(bX, bY, bZ, "leaves"); // Updates global world
            // Ensure solid property is set (if leaves are solid)
            world[leafKey] = { type: "leaves", solid: true }; // Change solid: false if leaves aren't solid
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
      world[topLeafKey] = { type: "leaves", solid: true }; // Change solid: false if leaves aren't solid
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
    return data
      ? {
          ...data,
          id: key,
          x: Math.floor(x),
          y: Math.floor(y),
          z: Math.floor(z),
        }
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

  function getChunk(x, z) {
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
    let heightValue =
      params.baseHeight + normalizedHeightNoise * params.terrainAmplitude;

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
    let weightPrimary = 1.0,
      weightSecondary = 0.0;
    let dominantParams; // Parameters of the biome that will dictate features like surface block

    // Determine primary and secondary biomes and their weights
    if (normalizedBiomeNoise < forestThreshold) {
      // Likely Plains or transitioning to/from Plains
      primaryBiome = BiomeType.Plains;
      dominantParams = biomeParameters[BiomeType.Plains];
      if (normalizedBiomeNoise > forestThreshold - TRANSITION_ZONE_WIDTH) {
        // Transitioning from Plains to Forest
        secondaryBiome = BiomeType.Forest;
        const progressIntoForest =
          (normalizedBiomeNoise - (forestThreshold - TRANSITION_ZONE_WIDTH)) /
          TRANSITION_ZONE_WIDTH;
        weightSecondary = smoothStep(0, 1, progressIntoForest);
        weightPrimary = 1.0 - weightSecondary;
      }
    } else if (normalizedBiomeNoise < mountainThreshold) {
      // Likely Forest or transitioning
      primaryBiome = BiomeType.Forest;
      dominantParams = biomeParameters[BiomeType.Forest];
      if (normalizedBiomeNoise < forestThreshold + TRANSITION_ZONE_WIDTH) {
        // Transitioning from Plains to Forest
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
        // Transitioning from Forest to Mountain
        secondaryBiome = BiomeType.Mountain;
        const progressIntoMountain =
          (normalizedBiomeNoise - (mountainThreshold - TRANSITION_ZONE_WIDTH)) /
          TRANSITION_ZONE_WIDTH;
        weightSecondary = smoothStep(0, 1, progressIntoMountain);
        weightPrimary = 1.0 - weightSecondary;
      }
    } else {
      // Likely Mountain or transitioning from Forest
      primaryBiome = BiomeType.Mountain;
      dominantParams = biomeParameters[BiomeType.Mountain];
      if (normalizedBiomeNoise < mountainThreshold + TRANSITION_ZONE_WIDTH) {
        // Transitioning from Forest to Mountain
        secondaryBiome = BiomeType.Forest;
        const progressIntoForest =
          (mountainThreshold + TRANSITION_ZONE_WIDTH - normalizedBiomeNoise) /
          TRANSITION_ZONE_WIDTH;
        weightSecondary = smoothStep(0, 1, progressIntoForest);
        weightPrimary = 1.0 - weightSecondary;
      }
    }

    // Get parameters for the primary and (if applicable) secondary biomes
    const paramsPrimary = biomeParameters[primaryBiome];
    const paramsSecondary =
      secondaryBiome !== undefined ? biomeParameters[secondaryBiome] : null;

    // 2. Calculate height based on primary biome
    let finalHeightValue = getHeightForBiomeParams(
      paramsPrimary,
      worldX,
      worldZ,
      paramsPrimary.terrainLacunarity || FRACTAL_LACUNARITY
    );

    // 3. If there's a secondary biome influence, blend its height
    if (paramsSecondary && weightSecondary > 0.001) {
      // Only blend if significant weight
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

    // The 'biome' and 'params' returned will be for the dominant biome,
    // which dictates surface type, tree types, etc. The height is blended.
    return {
      height: finalTerrainHeight,
      biome: primaryBiome, // Or decide dominant based on highest weight if more complex
      params: paramsPrimary, // Corresponds to the chosen 'biome'
    };
  }
function runWorker(messageType, workerData) {
    // Create a new worker
    const worker = new Worker('./serverChunkWorker.js',  workerData );

    // Listen for messages from the worker
}

// Run the worker
async function run(data) {
  try {
    // Send data to the worker and get the result
    const result = await runWorker(data);
    console.log('Worker result:', result);
  } catch (err) {
    console.error('Worker error:', err);
  }
}
const NUM_WORKERS = 8;
const workers = [];
const chunkGenerationQueue = []; // A queue for chunks waiting for a free worker

console.log(`[Server] Initializing a pool of ${NUM_WORKERS} worker threads.`);

for (let i = 0; i < NUM_WORKERS; i++) {
  const worker = new Worker('./serverChunkWorker.js', {
    workerData: {
        // Pass the seeds from the main thread's scope to the worker
        WORLD_SEED: WORLD_SEED,
        numericWorldSeed: numericWorldSeed
    }
  });

  // Error handling for each worker
  worker.on('error', (err) => {
    console.error(`[Worker ${i}] Error:`, err);
  });

  // Exit handling
  worker.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[Worker ${i}] stopped with exit code ${code}`);
    }
  });

  // Add the worker and its status to our pool
  workers.push({
    id: i,
    worker: worker,
    isBusy: false
  });
}
workers.forEach(workerInfo => {
    workerInfo.worker.postMessage({ type: "resetWorld" });
})
workers.forEach(workerInfo => {
    workerInfo.worker.on('message', (msg) => {
        if (msg.type === 'chunkDataLoaded') {
            const chunkId = getChunkId(msg.cx, msg.cz);
            const chunk = chunks.get(chunkId);

            if (chunk) {
                Object.assign(world, msg.blocks);
                chunk.state = ChunkState.DataLoaded;
                chunksNeedUpdate = true;

                socket.emit("chunkDataLoaded", {
                    cx: msg.cx,
                    cz: msg.cz,
                    blocks: msg.blocks,
                });
                if (msg.mobs && msg.mobs.length > 0) {
                    msg.mobs.forEach(mob => {
                        activeMobs.set(mob.id, mob);
                    });
                    // Send the new mobs to the client to be rendered
                    socket.emit('spawnMobs', msg.mobs);
                }
                } else {
                    console.warn(`[Server] Worker ${workerInfo.id} finished a task for an untracked chunk: ${chunkId}.`);
                }

            // Mark this worker as free
            workerInfo.isBusy = false;

            // Check if there are any jobs waiting in the queue
            if (chunkGenerationQueue.length > 0) {
                const nextChunkTask = chunkGenerationQueue.shift(); // Get the task object { chunk, dimension }
                
                // Mark as busy
                workerInfo.isBusy = true;

                // --- THIS IS THE CORRECTED LOGIC ---
                // We must unpack the task object and send the correct message format
                workerInfo.worker.postMessage({
                    type: 'generateChunk',              // Use the correct, generic type
                    chunk: nextChunkTask.chunk,         // Pass the chunk object correctly
                    dimension: nextChunkTask.dimension  // Pass the dimension
                });
            }
        }
    });
});
function dispatchChunkGenerationToWorker(chunk, dimension, genId) { // Add genId parameter
    const availableWorker = workers.find(w => !w.isBusy);

    if (availableWorker) {
        availableWorker.isBusy = true;
        availableWorker.worker.postMessage({
            type: 'generateChunk',
            chunk: chunk,
            dimension: dimension,
            generationId: genId // Add genId to the message
        });
    } else {
        // Add genId to the queued task object
        chunkGenerationQueue.push({ chunk, dimension, generationId: genId });
    }
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
      terrainAmplitude: 3, // Lower amplitude for smoother base
      terrainScale: 0.06, // Larger scale for very gentle base variations
      terrainOctaves: 3, // Fewer octaves for smoother base
      terrainPersistence: 0.45, // Lower persistence for smoother base

      // Parameters for the large, rolling hills on top
      hillAmplitude: 15, // How tall the big hills can be (added to baseHeight + base terrain)
      hillScale: 0.008, // Much smaller scale for very large, broad hills
      hillOctaves: 4, // A few octaves for some shape to the large hills
      hillPersistence: 0.5,

      // Other plains parameters (trees, surface blocks, etc.)
      treeDensity: 0.005,
      treeHeightMin: 3,
      treeHeightMax: 5, // Adjust as needed
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
      baseHeight: 20, // Higher base for mountains
      terrainAmplitude: 10, // Increased amplitude for mountains
      terrainScale: 0.02, // Slightly larger features for mountains
      treeDensity: 0.005,
      treeHeightMin: 3,
      treeHeightMax: 5,
      surfaceBlock: "grass",
      underSurfaceBlock: "stone",
      dirtDepth: 3,
      stoneLevelModifier: 0,
      snowLevel: 55, // Snow line
      terrainOctaves: 2, // More detail for mountains
      terrainPersistence: 0.55, // More ruggedness
      terrainLacunarity: 2.1, // Slightly faster detail increase
      roughnessAmplitude: 1, // More roughness for mountains
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
      // Optional: Override fractal params for this biome's heightmap if desired
      terrainOctaves: 0.2,
      terrainPersistence: 0.45,
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
  const caveNoiseScale = 0.06; // Controls the size/frequency of cave systems
  const caveThreshold = 0.65; // Noise value > threshold = air. Higher = smaller/rarer caves (Range 0-1)
  const minCaveY = -60; // Deepest caves can start
  const maxCaveY = 40; // Caves generally don't go much above this Y level

  function getBiome(worldX, worldZ) {
    const noiseValue = generateFractalNoise2D(
      // Use fractal noise for biomes
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
    );
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
    if (blockType === "stone") {
      dropType = "cobblestone";
    } else if (blockType === "grass") {
      dropType = "dirt";
    }

    // Check if it's a leaf block - low chance of dropping sapling or stick? (Future enhancement)
    // For now, leaves drop nothing to avoid clutter

    if (blockType !== "water") delete world[blockKey]; // Remove block from world data
    socket.emit("removeBlockWorker", { x, y, z });
    return true;
  }
  // REMOVE 'updateWorld' handler
  // case 'updateWorld':
  //    world = data;
  //    break;

  socket.on("addBlockWorker", async (data) => {
    const { x, y, z, type } = data;
    const chunkId = getChunkId(
      Math.floor(x / CHUNK_SIZE),
      Math.floor(z / CHUNK_SIZE)
    );

    // 1. Load the chunk data from the file
    let chunkObject = await loadChunkFromFile(chunkId);
    if (!chunkObject) {
      console.error(`Cannot add block: Chunk file ${chunkId} does not exist!`);
      saveChunkToFile(chunkId, {});
      return;
    }

    // 2. Modify the data
    const blockKey = getBlockKey(x, y, z);
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
    ].includes(type);
    chunkObject[blockKey] = { type: type, solid: isSolid };
    world[blockKey] = { type: type, solid: isSolid }; // Also update the in-memory cache

    // 3. Save the updated chunk data back to the file
    await saveChunkToFile(chunkId, chunkObject);

    // 4. Client remesh is handled separately by the client's logic
  });

  socket.on("removeBlockWorker", async (data) => {
    const { x, y, z } = data;
    const chunkId = getChunkId(
      Math.floor(x / CHUNK_SIZE),
      Math.floor(z / CHUNK_SIZE)
    );

    // 1. Load the chunk data
    let chunkObject = await loadChunkFromFile(chunkId);
    if (!chunkObject) {
      console.error(
        `Cannot remove block: Chunk file ${chunkId} does not exist!`
      );
      return;
    }

    // 2. Modify the data
    const blockKey = getBlockKey(x, y, z);
    if (chunkObject[blockKey]) {
      delete chunkObject[blockKey];
      if (world[blockKey]) delete world[blockKey]; // Also update in-memory cache
    }

    // 3. Save the updated data
    await saveChunkToFile(chunkId, chunkObject);
  });

  socket.on("generateChunkData", (data) => {
    // console.log(`Worker: Received generateChunkData for ${data.id}`); // Debug
    if (!chunks.has(data.id)) {
      chunks.set(data.id, { ...data, state: ChunkState.Unknown });
    }
    // generateChunkData updates the worker's 'world' internally now
    generateChunkData(chunks.get(data.id));
  });

  socket.on("remeshChunks", (data) => {
    // console.log("Worker: Received remesh request for chunks:", data); // Debug
    if (data && Array.isArray(data)) {
      data.forEach((chunkId) => {
        const chunk = chunks.get(chunkId);
        // Check state before marking (Keep this logic)
        if (
          chunk &&
          chunk.state !== ChunkState.Unknown &&
          chunk.state !== ChunkState.LoadingData &&
          chunk.state !== ChunkState.Meshing &&
          chunk.state !== ChunkState.NeedsRemesh
        ) {
          // console.log(`Worker: Marking chunk ${chunkId} (State: ${chunk.state}) for remesh.`); // Debug
          chunk.state = ChunkState.NeedsRemesh;
          chunksNeedUpdate = true;
        }
      });
    }
  });
  socket.on("disposeChunk", (data) => {
    // console.log("Worker: Disposing chunk", data.chunkId); // Debug
    chunks.delete(data.chunkId);
    console.log("chunk unloaded");
    // We might need to remove blocks associated with this chunk
    // from the worker's 'world' object to prevent memory leaks,
    // but this is more complex. For now, just remove the chunk ref.
  });

  socket.on("processUpdates", () => {
    chunksNeedUpdate = true;
  });
  socket.on("updateCameraPosition", (data) => {
    camera.position = data;
  });
  socket.on("updateChunks", () => {
    chunksNeedUpdate = true;
    updateChunks();
  });
  socket.on("chunksNeedUpdate", () => {
    chunksNeedUpdate = true;
    updateChunks();
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
  socket.on("removeBlockWorker", (data) => {
    const blockKey = getBlockKey(data.x, data.y, data.z);
    if (world[blockKey]) {
      delete world[blockKey]; // Delete the block from the worker's world
    }
  });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
