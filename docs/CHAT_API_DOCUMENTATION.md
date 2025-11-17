# Chat System API Documentation

## Database Schema

### 1. conversations table
```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255),
  type VARCHAR(50) DEFAULT 'direct', -- 'direct', 'group', 'support'
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_conversations_created_by ON conversations(created_by);
CREATE INDEX idx_conversations_updated_at ON conversations(updated_at DESC);
```

### 2. conversation_participants table
```sql
CREATE TABLE conversation_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'participant', -- 'admin', 'participant'
  joined_at TIMESTAMP DEFAULT NOW(),
  last_read_at TIMESTAMP,
  UNIQUE(conversation_id, user_id)
);

CREATE INDEX idx_conversation_participants_conversation ON conversation_participants(conversation_id);
CREATE INDEX idx_conversation_participants_user ON conversation_participants(user_id);
```

### 3. messages table
```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'text', -- 'text', 'file', 'system'
  created_at TIMESTAMP DEFAULT NOW(),
  edited_at TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);
```

### 4. message_reads table
```sql
CREATE TABLE message_reads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

CREATE INDEX idx_message_reads_message ON message_reads(message_id);
CREATE INDEX idx_message_reads_user ON message_reads(user_id);
```

### 5. message_attachments table
```sql
CREATE TABLE message_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size INTEGER,
  mime_type VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_message_attachments_message ON message_attachments(message_id);
```

---

## API Endpoints

### Authentication
All endpoints require Bearer token authentication:
```
Authorization: Bearer <token>
```

---

### 1. Get All Conversations
**GET** `/api/conversations`

Returns all conversations for the authenticated user.

**Response:**
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "id": "uuid",
      "title": "Conversation with John Doe",
      "type": "direct",
      "participants": [
        {
          "id": "uuid",
          "name": "John Doe",
          "email": "john@example.com",
          "role": "participant"
        }
      ],
      "lastMessage": {
        "content": "Hello there!",
        "timestamp": "2025-11-14T10:30:00Z",
        "senderName": "John Doe"
      },
      "unreadCount": 3,
      "createdAt": "2025-11-01T08:00:00Z",
      "updatedAt": "2025-11-14T10:30:00Z"
    }
  ]
}
```

**Implementation Notes:**
- Calculate `unreadCount` by counting messages created after `last_read_at` for this user
- Include user details from the `users` table via JOIN
- Order by `updated_at DESC`

---

### 2. Get Single Conversation
**GET** `/api/conversations/:id`

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "Conversation with John Doe",
    "type": "direct",
    "participants": [...],
    "createdAt": "2025-11-01T08:00:00Z",
    "updatedAt": "2025-11-14T10:30:00Z"
  }
}
```

---

### 3. Create Conversation
**POST** `/api/conversations`

**Request Body:**
```json
{
  "title": "New Conversation",
  "participantIds": ["user-uuid-1", "user-uuid-2"],
  "type": "direct"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Conversation created successfully",
  "data": {
    "id": "uuid",
    "title": "New Conversation",
    "type": "direct",
    "participants": [...],
    "createdAt": "2025-11-14T10:30:00Z",
    "updatedAt": "2025-11-14T10:30:00Z"
  }
}
```

**Implementation:**
1. Create conversation record
2. Add authenticated user as admin
3. Add all participantIds as participants
4. Return full conversation with participant details

---

### 4. Get Messages
**GET** `/api/conversations/:conversationId/messages`

**Query Parameters:**
- `limit` (optional, default: 50) - Number of messages to return
- `before` (optional) - Message ID to fetch messages before (for pagination)

**Response:**
```json
{
  "success": true,
  "count": 25,
  "data": [
    {
      "id": "uuid",
      "conversationId": "uuid",
      "senderId": "uuid",
      "senderName": "John Doe",
      "senderEmail": "john@example.com",
      "content": "Hello there!",
      "type": "text",
      "attachments": [],
      "readBy": ["user-uuid-1", "user-uuid-2"],
      "createdAt": "2025-11-14T10:30:00Z"
    }
  ],
  "hasMore": true
}
```

**Implementation Notes:**
- Verify user is participant in conversation
- Order by `created_at DESC`
- Include sender details from `users` table
- Include attachments from `message_attachments` table
- Include read status from `message_reads` table

---

### 5. Send Message (Text)
**POST** `/api/conversations/:conversationId/messages`

**Request Body:**
```json
{
  "content": "Hello there!",
  "type": "text"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "data": {
    "id": "uuid",
    "conversationId": "uuid",
    "senderId": "uuid",
    "senderName": "John Doe",
    "senderEmail": "john@example.com",
    "content": "Hello there!",
    "type": "text",
    "attachments": [],
    "readBy": ["uuid"],
    "createdAt": "2025-11-14T10:30:00Z"
  }
}
```

**Implementation:**
1. Verify user is participant
2. Create message record
3. Automatically mark as read by sender
4. Update conversation `updated_at`
5. **Trigger Supabase Realtime notification**

---

### 6. Send Message with File
**POST** `/api/conversations/:conversationId/messages`

**Content-Type:** `multipart/form-data`

**Request Body:**
- `content` (string) - Message text
- `type` (string) - "file"
- `file` (file) - File to upload

**Response:**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "data": {
    "id": "uuid",
    "conversationId": "uuid",
    "senderId": "uuid",
    "senderName": "John Doe",
    "senderEmail": "john@example.com",
    "content": "Check out this document",
    "type": "file",
    "attachments": [
      {
        "id": "uuid",
        "fileName": "document.pdf",
        "fileSize": 1024000,
        "filePath": "https://supabase.storage/path/to/file.pdf",
        "mimeType": "application/pdf"
      }
    ],
    "readBy": ["uuid"],
    "createdAt": "2025-11-14T10:30:00Z"
  }
}
```

**Implementation:**
1. Upload file to Supabase storage: `chat-attachments/{conversationId}/{uuid}-{filename}`
2. Create message with file type
3. Create attachment record
4. Return complete message with attachment details

---

### 7. Mark Message as Read
**PUT** `/api/messages/:messageId/read`

**Response:**
```json
{
  "success": true,
  "message": "Message marked as read"
}
```

**Implementation:**
1. Create record in `message_reads` if not exists
2. Update sender's unread count

---

### 8. Mark Conversation as Read
**PUT** `/api/conversations/:conversationId/read`

Marks all messages in conversation as read.

**Response:**
```json
{
  "success": true,
  "message": "Conversation marked as read"
}
```

**Implementation:**
1. Update `last_read_at` in `conversation_participants` to NOW()
2. This effectively marks all current messages as read

---

### 9. Delete Message
**DELETE** `/api/messages/:messageId`

**Response:**
```json
{
  "success": true,
  "message": "Message deleted successfully"
}
```

**Implementation:**
- Soft delete: Set `deleted_at` timestamp
- Only sender or admin can delete
- Cascade delete attachments from storage

---

### 10. Search Messages
**GET** `/api/conversations/:conversationId/messages/search?q=query`

**Query Parameters:**
- `q` (required) - Search query

**Response:**
```json
{
  "success": true,
  "count": 5,
  "data": [
    {
      "id": "uuid",
      "conversationId": "uuid",
      "senderId": "uuid",
      "senderName": "John Doe",
      "content": "...matched content...",
      "createdAt": "2025-11-14T10:30:00Z"
    }
  ]
}
```

**Implementation:**
- Use full-text search: `WHERE content ILIKE '%query%'`
- Verify user is participant
- Order by relevance/date

---

## Supabase Realtime Setup

### Enable Realtime on Tables
```sql
-- Enable realtime for messages table
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- Enable realtime for conversations table
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
```

### Row Level Security (RLS)
```sql
-- Enable RLS
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;

-- Messages: Users can only see messages from their conversations
CREATE POLICY "Users can view messages from their conversations"
ON messages FOR SELECT
USING (
  conversation_id IN (
    SELECT conversation_id
    FROM conversation_participants
    WHERE user_id = auth.uid()
  )
);

-- Conversations: Users can only see their own conversations
CREATE POLICY "Users can view their conversations"
ON conversations FOR SELECT
USING (
  id IN (
    SELECT conversation_id
    FROM conversation_participants
    WHERE user_id = auth.uid()
  )
);
```

---

## Frontend Real-time Implementation

### Subscribe to New Messages
```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Subscribe to messages in a specific conversation
const subscription = supabase
  .channel(`conversation:${conversationId}`)
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `conversation_id=eq.${conversationId}`
    },
    (payload) => {
      console.log('New message:', payload.new)
      // Update UI with new message
      setMessages(prev => [...prev, payload.new])
    }
  )
  .subscribe()

// Clean up on unmount
return () => {
  subscription.unsubscribe()
}
```

---

## Testing the API

### Create a conversation
```bash
curl -X POST http://localhost:3001/api/conversations \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Conversation",
    "participantIds": ["user-id-1", "user-id-2"],
    "type": "direct"
  }'
```

### Send a message
```bash
curl -X POST http://localhost:3001/api/conversations/CONVERSATION_ID/messages \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Hello World!",
    "type": "text"
  }'
```

### Get messages
```bash
curl http://localhost:3001/api/conversations/CONVERSATION_ID/messages?limit=20 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Notes for Backend Implementation

1. **Use transactions** when creating conversations (conversation + participants)
2. **Update conversation.updated_at** whenever a new message is sent
3. **Calculate unread counts** efficiently using `last_read_at`
4. **Implement pagination** for message history
5. **Use Supabase storage** for file uploads (reuse existing document upload logic)
6. **Broadcast events** after message creation for real-time updates
7. **Validate permissions** - users can only access conversations they're participants in
8. **Handle file cleanup** when messages are deleted

---

## Performance Considerations

- Index all foreign keys
- Use `SELECT DISTINCT ON` for fetching last messages
- Cache conversation participant lists
- Limit message history to prevent large data transfers
- Implement read receipts efficiently (batch updates)
