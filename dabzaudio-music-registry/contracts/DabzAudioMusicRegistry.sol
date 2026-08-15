// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * DabzAudio Music Registry
 *
 * Stores a verifiable anchor for a recording:
 * - SHA-256 audio hash
 * - DabzAudio Music ID
 * - metadata URI
 * - registrar
 * - registration timestamp
 *
 * IMPORTANT:
 * This contract is a technical registry/anchor.
 * It does not by itself create or transfer legal copyright ownership.
 */
contract DabzAudioMusicRegistry {
    struct MusicRecord {
        string musicId;
        string metadataUri;
        address registrar;
        uint256 registeredAt;
    }

    mapping(bytes32 => MusicRecord) private records;

    event MusicRegistered(
        bytes32 indexed audioHash,
        string musicId,
        string metadataUri,
        address indexed registrar
    );

    function registerMusic(
        bytes32 audioHash,
        string calldata musicId,
        string calldata metadataUri
    ) external {
        require(audioHash != bytes32(0), "Invalid hash");
        require(bytes(musicId).length > 0, "Invalid music ID");
        require(records[audioHash].registeredAt == 0, "Already registered");

        records[audioHash] = MusicRecord({
            musicId: musicId,
            metadataUri: metadataUri,
            registrar: msg.sender,
            registeredAt: block.timestamp
        });

        emit MusicRegistered(
            audioHash,
            musicId,
            metadataUri,
            msg.sender
        );
    }

    function getMusic(
        bytes32 audioHash
    )
        external
        view
        returns (
            string memory musicId,
            string memory metadataUri,
            address registrar,
            uint256 registeredAt
        )
    {
        MusicRecord memory record = records[audioHash];

        return (
            record.musicId,
            record.metadataUri,
            record.registrar,
            record.registeredAt
        );
    }
}
