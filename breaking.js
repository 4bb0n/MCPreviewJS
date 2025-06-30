
const breakInfo = {
    'stone':          { hardness: 1.5, tool: 'pickaxe' },
    'cobblestone':    { hardness: 2,   tool: 'pickaxe' },
    'coal_ore':       { hardness: 3,   tool: 'pickaxe' },
    'oxidized_iron_ore': { hardness: 3, tool: 'pickaxe' },
    'landmine':       { hardness: 1.5, tool: 'pickaxe' }, // Can now be mined with a pickaxe
    
    'log':            { hardness: 2,   tool: 'any', optimalTool: 'axe' },
    'plank':          { hardness: 2,   tool: 'any', optimalTool: 'axe' },
    'craftingtable':  { hardness: 2.5, tool: 'any', optimalTool: 'axe' },

    'dirt':           { hardness: 0.5, tool: 'any', optimalTool: 'shovel' }, // Dirt is best with a shovel
    'grass':          { hardness: 0.6, tool: 'any', optimalTool: 'shovel' }, // Grass is best with a shovel
    
    'leaves':         { hardness: 0.2, tool: 'any', optimalTool: 'hoe' }, // 'any' means no specific tool required
    'bedrock':        { hardness: -1,  tool: 'none' } // Unbreakable
};

// This new object maps specific items to their tool CATEGORY.
const toolTypes = {
    'wooden_pickaxe': 'pickaxe',
    'stone_pickaxe': 'pickaxe', // Ready for when you add it
    'iron_pickaxe': 'pickaxe',  // Ready for when you add it

    'wooden_axe': 'axe',
    'stone_axe': 'axe',
    'iron_axe': 'axe',

    'wooden_shovel': 'shovel',
    'stone_shovel': 'shovel',
    'iron_shovel': 'shovel'
};
// --- START: ADD TOOL EFFECTIVENESS RULES ---
const toolEffectiveness = {
    // Tool Type: [Array of block types it's effective against]
    'wooden_pickaxe': ['stone', 'cobblestone', 'coal_ore', 'iron_ore'],
    'wooden_axe': ['log', 'plank', 'craftingtable'], // Added planks/table
    'wooden_shovel': ['dirt', 'grass'],
    'stone_pickaxe': ['stone', 'cobblestone', 'coal_ore', 'iron_ore'],
    'stone_axe': ['log', 'plank', 'craftingtable'],
    'stone_shovel': ['dirt', 'grass'],
};
// --- START: ADD MATERIAL-SPECIFIC TOOL SPEEDS ---

// Remove this old constant:
// const toolSpeedMultiplier = 5.0; // How much faster the correct tool is (OLD - REMOVE)

// Add this new object:
const toolMaterialSpeeds = {
    // Pickaxes
    'wooden_pickaxe': 4.0, // Example: Wooden is 4x faster than base breaking time for applicable blocks
     'stone_pickaxe': 6.0,
     'iron_pickaxe': 8.0,
     'diamond_pickaxe': 12.0,

    'wooden_axe': 3.0,
     'stone_axe': 4.5,
     'iron_axe': 6.0,
     'diamond_axe': 9.0,

    'wooden_shovel': 5.0,  
     'stone_shovel': 7.5,
     'iron_shovel': 10.0,
     'diamond_shovel': 15.0,
};

// Keep the default multiplier for hands / wrong tool
const defaultSpeedMultiplier = 1.0;
// --- END: ADD MATERIAL-SPECIFIC TOOL SPEEDS ---
const toolSpeedMultiplier = 5.0; // How much faster the correct tool is
const toolTextures = {
    wooden_pickaxe :textureLoader.load('wooden_pickaxe.jpg'),
}
const toolMaterials = {
    wooden_pickaxe: new THREE.MeshBasicMaterial({ map: toolTextures.wooden_pickaxe }),
}
