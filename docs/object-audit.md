# Object properties audit

Goal: every control in the object inspector must write a property the game really
reads. No invented options, no Perry only fields on stock WMW objects, and no
missing controls for properties the levels use a lot.

## Source of truth + method

The numbers below come from the unpacked game, not from guessing:

- **345** `Objects/*.hs` definitions (the `DefaultProperties` per object)
- **636** `Levels/*.xml` files, **27043** placed objects total

A script (`scratchpad/audit.mjs`) reproduces `panels.js` `_objectKind()` exactly,
buckets every placed object the same way the inspector does, then counts how often
each property is **authored in a level** and its value range. Rule applied:

> A control may only exist if it writes a property that is authored in real levels
> (or is a real `.hs` default the object actually carries). A property authored
> **0×** across all 636 levels and present in **0** `.hs` defaults is fictional and
> gets removed.

## The real object Types (from the .hs defaults)

`Type` census across all 345 `.hs` and all authored level objects:

| Type | .hs files | authored in levels |
|---|---:|---:|
| star (ducks, incl. teleport) | 26 | 3263 |
| spout / drain | 21 | 3093 |
| bomb | 1 | 548 |
| switch | 13 | 531 |
| icyhot (icicles) | 6 | 281 |
| fan / vacuum | 20 | 187 |
| waterballoon | 1 | 124 |
| collectible (hidden) | 111 | 122 |
| fluidconverter | 8 | 117 |
| yswitch | 3 | 88 |
| dirtywall | 3 | 34 |
| algaehider | 28 | 0 (Type never re-authored) |
| mysterycave | 10 | 0 |
| floater | 1 | 0 |

**There is no `temperatureray`, `generator`, `mirror` or `pipe` Type in the game**,
and there is no `.hs` whose filename contains `mirror`. The panels built for those
were writing properties that appear **0× in 636 levels and 0 `.hs` defaults**.

## Panels removed (fictional / unreachable)

Each of these required a Type or property no real object has, so no placed object
ever reached them. Pure dead code removal, zero behaviour change.

| Panel | Trigger it needed | Real occurrences |
|---|---|---|
| **ray** (temperatureray) | `Type=temperatureray`, `RayAngle`, `RayBeamType` | 0 / 0 / 0 |
| **generator** | `Type=generator`, `GeneratorSprites`, `AllowedFluids` | 0 / 0 / 0 |
| **pipe** | `Type=pipe`, `PipeType`, `PipeWidth` | 0 / 0 / 0 |
| **mirror** | `Type=mirror` or a `*mirror*` file | 0 objects, 0 files |

`TemperatureType` does exist, but only on the 6 icicles, where it is a fixed
`cold` default that no level overrides (0 authored). The ray dropdown
(hot/cold/sludge/matter/turf) and `RayBeamType`/`RayAngle` were invented, so the
panel is gone. Icicles now get an honest info note (below).

## Dead controls removed from real panels

| Panel | Removed control | Property | Authored | Why |
|---|---|---|---:|---|
| bomb | Gravity | `GravityScale` | 0 | not in `bomb.hs`, never set on a bomb |
| balloon | Damping | `VelDamping` | 0 | not in `balloon.hs`, never authored |
| balloon | Has string / Poppable | `HasString`, `FingerPoppable` | 0 | Perry mod fields, absent from WMW |
| collectible | Cut radius | `CutRadius` | 0 | in 1 `.hs`, never authored |
| collectible | Duck fluid | `GnomeType` | 0 | Perry mod field |
| teleport | Exit | `ConnectedObject0` | 0 (on teleporters) | teleporters do not link by property |
| brokenpipe | Gravity | `GravityScale` | 0 | a broken pipe is a `DrainSpout`, not a falling body |
| ypipe | Switch side | `YSwitchPosition`="left"/"right" | wrong values | real field is `0`/`1`, not a string |
| ypipe | Switch / Port | `ConnectedYSwitchPort0` | 2 | the real outputs are `ConnectedSpout0/1` |
| generic | Damping | `VelDamping` | 0 | never present |

## Missing controls added (property is common, had no control)

| Panel | Added control | Property | Authored | Notes |
|---|---|---|---:|---|
| teleport | Wait + Move time | `TeleportWaitTime`, `TeleportMoveTime` | 250 / 197 | kept, were already real |
| teleport | Cuts through rock | `CutsRock` | 189 | new Yes/No |
| teleport | Movement ease | `TeleportMoveEase` | 92 | new both/in dropdown |
| teleport | Burst on arrival | `Burst` | 25 | new Yes/No |
| brokenpipe | Leak output | `ConnectedSpout0` (+probability) | 588 | where the pipe spills to |
| ypipe | Output 1 / Output 2 | `ConnectedSpout0`, `ConnectedSpout1` | 87 / 73 | the two branch targets |
| ypipe | Starts open | `FirstLeftSpout` / `FirstRightSpout` | 74 / 88 | one side starts open |
| spout | Blockable | `Blockable` | 46 | stream can be blocked by terrain |

## Niche types now on the generic panel — decision per type

The prompt called these out specifically. None of them author any property in
levels beyond `Angle` (their behaviour is baked into the variant `.hs`), so a
control panel would be invented. Instead each gets a short read only **info note**
explaining what it is, which is the honest answer.

| Type | Authorable props in levels | Decision |
|---|---|---|
| icyhot (icicle) | none (`TemperatureType=cold` fixed) | info note: "freezes fluid / pops balloons, fixed" |
| dirtywall | none (`ParticleArea` intrinsic) | info note: destructible dirt wall |
| algaehider | none (`AlgaeCount`/`IgnoreInEditorObjectSelect` intrinsic, `Type` 0× authored) | info note: hidden under algae |
| mysterycave | none (`MaterialType`/`PlatinumType` intrinsic) | info note: mystery duck cave |
| floater | none (`floater.hs` has empty defaults) | info note: floating prop |
| collectible (hidden) | none (`CollectibleID` intrinsic per variant) | note in its own panel |

## Panels left unchanged (already correct)

Verified every control writes a property the levels use:

- **spout/drain** — `SpoutType`, `FluidType`, `ParticlesPerSecond` (610), `NumberParticles`
  (847), `ParticleSpeed` (1060), `ExpulsionAngleVariation` (52), `Timer0/1` (155),
  `ConnectedSpout*` (941), `ConnectedConverter` (119). `ExpulsionAngle` is rarely
  overridden but is a genuine spout default, so it stays. (Added `Blockable`.)
- **fan** — `VacuumOn` (65), `VacuumMaxForce` (60), `VacuumMaxD` (106), `VacuumMinAngle`
  (48), `VacuumMaxAngle` (45), `VacuumFriction` (45) + controlled by group. (Candidate
  not added: `VacuumForce` (69) overlaps `VacuumMaxForce`; exposing both is confusing.)
- **vacuum** — same vacuum fields (12–27 each) + `ConnectedSpout` output (31).
- **switch** — read only `SwitchType` + `ConnectedObject0..N` group (459/93/29/...).
- **converter** — `FluidType` static (97) or `FluidType0..5` dynamic (20/19/7).
- **sprinkler** — `SprinklerWidth` (31), `SprinklerSteps` (31), `FluidType` (31),
  `ParticlesPerSecond` (25), `NumberParticles` (7).
- **motor** — `MotorMoveSpeed` (465), `MotorOn` (125), `MotorWaitTime` (94),
  `MotorTurnSpeed` (63), `MotorWaitTurn` (51), `MotorPingPong` (12), paths.
- **collectible (ducks)** — `StarType` (1457). Now shown only when the object has it.
- **pivot** — `PinMinAngle` / `PinMaxAngle` (27 / 27).
- **attachment (Parent)** — 1239 uses; the universal "moves with" link.

## What was deliberately NOT done

- The now unused dictionary keys for the removed panels (`sec.ray`, `gen.*`,
  `pipe.*`, `mirror.hint`, `prop.cutRadius`, `prop.gnomeType`, ...) were **left in all
  four languages** instead of deleted. They are inert and removing the same key from
  four distant language blocks is the kind of change that silently breaks i18n
  parity; keeping them is the safe choice. Parity stays 4×-equal.
- `VacuumForce`, `ParticleQueueThreshold`, `PlatinumType`, the older
  `YSwitchPosition` 0/1 encoding and other rare-but-real fields are reachable through
  the **Advanced** raw property editor, just not promoted to a smart control.
