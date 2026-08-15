const { ethers } = require("ethers");

const ABI = [
    "function registerMusic(bytes32 audioHash, string musicId, string metadataUri) external",
    "function getMusic(bytes32 audioHash) external view returns (string musicId, string metadataUri, address registrar, uint256 registeredAt)",
    "event MusicRegistered(bytes32 indexed audioHash, string musicId, string metadataUri, address indexed registrar)"
];

function isBlockchainConfigured() {
    return Boolean(
        process.env.BLOCKCHAIN_ENABLED === "true" &&
        process.env.RPC_URL &&
        process.env.REGISTRY_CONTRACT_ADDRESS &&
        process.env.REGISTRY_PRIVATE_KEY
    );
}

async function registerOnBlockchain(audioHashHex, musicId, metadataUri) {
    if (!isBlockchainConfigured()) {
        return {
            enabled: false,
            status: "pending",
            transactionHash: null,
            message: "Blockchain anchoring is disabled. Enable it in Railway environment variables."
        };
    }

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.REGISTRY_PRIVATE_KEY, provider);

    const contract = new ethers.Contract(
        process.env.REGISTRY_CONTRACT_ADDRESS,
        ABI,
        wallet
    );

    const bytes32Hash = `0x${audioHashHex}`;

    const transaction = await contract.registerMusic(
        bytes32Hash,
        musicId,
        metadataUri
    );

    const receipt = await transaction.wait();

    return {
        enabled: true,
        status: "confirmed",
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        chainId: process.env.CHAIN_ID || null
    };
}

module.exports = {
    registerOnBlockchain,
    isBlockchainConfigured
};
