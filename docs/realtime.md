# Realtime protocol (WebSocket)

Endpoint: `wss://<host>/api/v1/ws`

## Client → server

| Message | Notes |
|---|---|
| `{"type":"auth","token":"<access token>"}` | Must be the first message, within 10 s, from an onboarded account. Invalid → close code `4401`. Reply: `{"type":"ready","user_id":"..."}`. |
| `{"type":"ping"}` | Every ~25 s. Refreshes online presence and room presence for subscribed rooms you've joined. Reply: `pong`. |
| `{"type":"subscribe","channel":"room:<id>"}` | Requires the same access as `GET /rooms/{id}` (private, banned, blocked host and private-community checks). Reply: `subscribed`. |
| `{"type":"subscribe","channel":"game:<id>"}` | Requires game access (and room access for room games). Reply: `subscribed`. |
| `{"type":"unsubscribe","channel":"..."}` | |
| `{"type":"typing","conversation_id":"...","is_typing":true}` | Only members of the conversation, never across blocks. |

Game moves don't go over the socket. They use REST (`POST /games/{id}/action` with the current `version`); the socket only tells clients that state changed.

Client events (except `ping`) are rate limited (120 per 30 s). Messages over 16 KB are rejected. Suspended or banned accounts are closed with `4403`. Errors come back as `{"type":"error","code":"...","for":"<type>"}`.

## Server → client envelope

```json
{ "type": "message.created", "data": { ... }, "id": "<unique event id>", "ts": "<iso time>" }
```

Clients drop events whose `id` they've already seen (duplicates can occur after reconnects). After any reconnect, clients refetch their queries. Events are hints that something changed; the REST API is the source of truth.

## Events

| Event | Channel | Payload | Who receives it |
|---|---|---|---|
| `message.created` | user | `MessageOut` | Both conversation members |
| `message.updated` | user | `MessageOut` (deleted → empty content) | Both members |
| `conversation.read` | user | `{conversation_id, user_id, read_at?}` | Self; the other member only if both share read receipts |
| `typing.started` / `typing.stopped` | user | `{conversation_id, user_id}` | The other member |
| `presence.updated` | user | `{user_id, online}` | Friends, only if the user shows online status |
| `friend_request.created` | user | `{request_id, from}` | Recipient |
| `friend_request.updated` | user | `{request_id, status}` | Sender and recipient (declines are shown only to the recipient) |
| `friendship.removed` | user | `{user_id}` | The other person |
| `block.updated` | user | `{user_id, blocked}` | The blocker only |
| `notification.created` | user | notification summary (never message text) | Recipient |
| `call.incoming` | user | `{room_id, from}` | The friend being called |
| `call.declined` | user | `{room_id, user_id}` | The caller |
| `icebreaker.matched` / `icebreaker.updated` | user | `{session_id}` | Both participants |
| `room.removed` | user | `{room_id, banned}` | The removed person |
| `account.status` | user | `{status, until?}` | The affected account |
| `room.participant_joined` / `room.participant_left` | room | `{room_id, user / user_id, role?}` | Room subscribers |
| `room.participant_updated` | room | `{room_id, user_id, action, role, muted_by_host, hand_raised, can_speak?, camera_blocked?, automatic?}`. `action` includes `camera_off` / `camera_on`; `automatic: true` means the live-video check turned the camera off. | Room subscribers |
| `room.updated` | room | changed fields | Room subscribers |
| `room.message` | room | `RoomMessageOut` | Room subscribers |
| `room.reaction` | room | `{room_id, user_id, reaction}` | Room subscribers |
| `room.timer` | room | `{room_id, timer}` | Room subscribers |
| `room.game_created` | room | `{room_id, session_id, game_type, code}` | Room subscribers |
| `room.ended` | room | `{room_id, reason}` | Room subscribers |
| `game.state_updated` | game | `{session_id, version, status}`. Clients refetch their **personalised** view, so hidden cards and Werewolf roles are never broadcast. | Game subscribers |

## Scaling

Each instance holds its own sockets. Events are published to Redis (`veyvo:events`), and every instance delivers to its matching local sockets. With `REDIS_URL` unset, an in-process bus is used, which only works for a single instance.
