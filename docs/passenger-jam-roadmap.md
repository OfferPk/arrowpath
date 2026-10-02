# Passenger Jam roadmap

## Implemented MVP

Passenger Jam is a separate home-menu mode; Campaign and Daily remain in place. The prototype has one authored 6×6 board with eight two-cell buses, a visible 16-passenger ordered queue, two parking bays, and an in-memory restart. Each bus has two seats. A bus may enter an open bay whenever its route to the board edge is clear, regardless of the queue's next color. Passengers board only from the front of the queue and only into a parked bus of the same color; if more than one bay has a matching bus, the lowest-numbered bay boards first. A bus leaves automatically when it reaches 2/2 seats and frees its bay. A blocked route or full lot rejects a dispatch without changing the board, queue, bays, or move count. The move counter tracks successful board-to-bay dispatches.

The authored solution opens routes in this order: Gold east, Coral east, Teal north, Gold north, Coral west, Teal west, Gold west, Coral south. The first Gold bus waits while the two Coral passengers board the next matching bus; the queue then feeds Gold and Teal buses in order. Later, Gold and Coral buses share the bays briefly before their passengers arrive. The win requires the board and passenger queue to be empty and both bays to be clear.

## Playtest and polish

1. Play the authored board on narrow phones and short landscape screens; check that all queue tokens remain understandable and that the board, bays, move count, feedback, and controls fit or scroll naturally.
2. Observe first-time players without coaching. Confirm they understand that route clearance controls parking, queue order controls boarding, unmatched buses wait in a bay, and a full lot blocks another dispatch.
3. Tune arrival/departure timing, blocked/full feedback, contrast, focus behavior, reduced-motion behavior, and the seat-count presentation from those observations.
4. Add a small regression checklist for touch targets, keyboard activation, screen-reader labels, restart, and returning home without losing the current in-memory run.

## Puzzle-content growth

Add more hand-authored 6×6 boards first, varying blocker chains, bus colors, queue order, and the points where one or both bays stay occupied. Give every board a written intended solution and verify the queue can be completely served without exceeding the two-bay capacity. Then add a pure solver/validator for route clearance, queue order, seat capacity, bay occupancy, and win-state reachability before growing the level set. Introduce difficulty tiers only after several boards have been playtested.

## Explicitly deferred

This MVP does not save Passenger Jam progress, add Campaign/Daily progression or rewards, include hints/undo, provide a level picker, generate boards procedurally, add more passenger colors or variable capacities, include copied or third-party game art, or change/replace the ArrowPath arrow puzzle. No external services, analytics, network calls, publication, or account changes are part of this mode.
