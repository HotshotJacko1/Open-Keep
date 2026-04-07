package com.jackbarkerapps.openkeep.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "notes")
data class NoteEntity(
    @PrimaryKey
    val id: String,
    val title: String,
    val content: String, // MD content or JSON string for lists
    val type: String, // "TEXT" or "LIST"
    val createdAt: Long,
    val updatedAt: Long,
    val isPinned: Boolean,
    val isArchived: Boolean,
    val deleted: Boolean,
    val tags: String, // Serialized JSON array
    val syncState: String, // SYNCED, PENDING, FAILED
    val images: String = "[]" // Serialized JSON array
)
