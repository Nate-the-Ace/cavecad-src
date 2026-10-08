# Symbol coverage audit

Date: 2026-10-04 (0.9.208.0). Reference: Therion point types, from the Therion book source (thbook ch.2, the `point` command). CaveCAD side: `CsSymbols.CATALOG`, Area Fill and Shaped Lines, as the Therion sketch importer maps them (`CsSketch.POINTS`).

Result: **44 symbols added**, and the importer now maps every Therion point type that has a cave-map meaning. 116 types were checked.

## Summary

| Status | Types |
|---|---|
| symbol (existing) | 45 |
| symbol (new) | 46 |
| area fill | 3 |
| text / callout | 5 |
| not drawn | 17 |

`not drawn` types are deliberate, with the reason in the table.

## Therion point types

| Group | Type | Status | Detail |
|---|---|---|---|
| special objects | `dimensions` | not drawn | editor scaffolding |
| special objects | `section` | not drawn | a reference to another scrap, not a symbol |
| special objects | `station` | not drawn | the drawing letters its own stations |
| labels | `altitude` | text / callout | Callout / text tools |
| labels | `date` | text / callout | Callout / text tools |
| labels | `height` | text / callout | Callout / text tools |
| labels | `label` | text / callout | Callout / text tools |
| labels | `passage-height` | symbol (existing) | `SYM_CEILING_HEIGHT` |
| labels | `remark` | text / callout | Callout / text tools |
| labels | `station-name` | not drawn | station labels do this |
| symbolic passage fills | `bedrock` | area fill | Area Fill pattern (the point also lands on its layer) |
| symbolic passage fills | `blocks` | symbol (existing) | `SYM_BREAKDOWN`; also an Area Fill |
| symbolic passage fills | `clay` | symbol (existing) | `SYM_CLAY_MUD_TICK`; also an Area Fill |
| symbolic passage fills | `debris` | symbol (existing) | `SYM_BREAKDOWN`; also an Area Fill |
| symbolic passage fills | `guano` | symbol (existing) | `SYM_GUANO`; also an Area Fill |
| symbolic passage fills | `ice` | area fill | Area Fill pattern (the point also lands on its layer) |
| symbolic passage fills | `mudcrack` | symbol (existing) | `SYM_CLAY_MUD_TICK`; also an Area Fill |
| symbolic passage fills | `mud` | symbol (existing) | `SYM_CLAY_MUD_TICK` |
| symbolic passage fills | `pebbles` | symbol (existing) | `SYM_SAND_GRAVEL_DOT`; also an Area Fill |
| symbolic passage fills | `raft` | not drawn | no glyph yet |
| symbolic passage fills | `sand` | symbol (existing) | `SYM_SAND_GRAVEL_DOT`; also an Area Fill |
| symbolic passage fills | `snow` | area fill | Area Fill pattern (the point also lands on its layer) |
| symbolic passage fills | `water` | symbol (existing) | `SYM_DRIP_SEEP`; also an Area Fill |
| speleothems | `anastomosis` | symbol (new) | `SYM_ANASTOMOSIS` |
| speleothems | `aragonite` | symbol (new) | `SYM_ARAGONITE` |
| speleothems | `cave-pearl` | symbol (new) | `SYM_CAVE_PEARL` |
| speleothems | `clay-tree` | symbol (new) | `SYM_CLAY_TREE` |
| speleothems | `crystal` | symbol (new) | `SYM_CRYSTAL` |
| speleothems | `curtains` | symbol (existing) | `SYM_DRAPERY` |
| speleothems | `curtain` | symbol (existing) | `SYM_DRAPERY` |
| speleothems | `disc-pillar` | symbol (existing) | `SYM_COLUMN` |
| speleothems | `disc-stalactite` | symbol (existing) | `SYM_STALACTITE` |
| speleothems | `disc-stalagmite` | symbol (existing) | `SYM_STALAGMITE` |
| speleothems | `disc-pillars` | symbol (existing) | `SYM_COLUMN` |
| speleothems | `disc-stalactites` | symbol (existing) | `SYM_STALACTITE` |
| speleothems | `disc-stalagmites` | symbol (existing) | `SYM_STALAGMITE` |
| speleothems | `disk` | not drawn | disc formations share the cone glyphs |
| speleothems | `flowstone` | symbol (existing) | `SYM_FLOWSTONE`; also an Area Fill |
| speleothems | `flute` | symbol (new) | `SYM_FLUTE` |
| speleothems | `gypsum-flower` | symbol (new) | `SYM_GYPSUM_FLOWER` |
| speleothems | `gypsum` | symbol (new) | `SYM_GYPSUM` |
| speleothems | `helictites` | symbol (new) | `SYM_HELICTITE` |
| speleothems | `helictite` | symbol (new) | `SYM_HELICTITE` |
| speleothems | `karren` | symbol (new) | `SYM_KARREN` |
| speleothems | `moonmilk` | symbol (existing) | `SYM_MOONMILK_POPCORN`; also an Area Fill |
| speleothems | `pendant` | symbol (new) | `SYM_PENDANT` |
| speleothems | `pillar-with-curtains` | symbol (existing) | `SYM_COLUMN` |
| speleothems | `pillars-with-curtains` | symbol (existing) | `SYM_COLUMN` |
| speleothems | `pillar` | symbol (existing) | `SYM_COLUMN` |
| speleothems | `popcorn` | symbol (existing) | `SYM_MOONMILK_POPCORN` |
| speleothems | `raft-cone` | symbol (new) | `SYM_VOLCANO` |
| speleothems | `rimstone-dam` | symbol (existing) | `SYM_RIMSTONE_DAM` |
| speleothems | `rimstone-pool` | symbol (existing) | `SYM_RIMSTONE_DAM` |
| speleothems | `scallop` | symbol (new) | `SYM_SCALLOP` |
| speleothems | `soda-straw` | symbol (new) | `SYM_SODA_STRAW` |
| speleothems | `stalactite-stalagmite` | symbol (existing) | `SYM_COLUMN` |
| speleothems | `stalactites-stalagmites` | symbol (existing) | `SYM_COLUMN` |
| speleothems | `stalactite` | symbol (existing) | `SYM_STALACTITE` |
| speleothems | `stalactites` | symbol (existing) | `SYM_STALACTITE` |
| speleothems | `stalagmite` | symbol (existing) | `SYM_STALAGMITE` |
| speleothems | `stalagmites` | symbol (existing) | `SYM_STALAGMITE` |
| speleothems | `volcano` | symbol (new) | `SYM_VOLCANO` |
| speleothems | `wall-calcite` | symbol (existing) | `SYM_FLOWSTONE` |
| equipment | `anchor` | symbol (existing) | `SYM_BOLT` |
| equipment | `bridge` | symbol (new) | `SYM_BRIDGE` |
| equipment | `camp` | symbol (new) | `SYM_CAMP` |
| equipment | `fixed-ladder` | symbol (new) | `SYM_FIXED_LADDER` |
| equipment | `gate` | symbol (new) | `SYM_GATE` |
| equipment | `handrail` | symbol (new) | `SYM_HANDRAIL` |
| equipment | `masonry` | symbol (new) | `SYM_MASONRY` |
| equipment | `nameplate` | symbol (new) | `SYM_NAMEPLATE` |
| equipment | `no-equipment` | not drawn | editor marker |
| equipment | `no-wheelchair` | not drawn | access notes belong in a callout |
| equipment | `rope-ladder` | symbol (existing) | `SYM_CABLE_LADDER` |
| equipment | `rope` | symbol (existing) | `SYM_ROPE_DROP` |
| equipment | `steps` | symbol (new) | `SYM_STEPS` |
| equipment | `traverse` | symbol (existing) | `SYM_TRAVERSE_LINE` |
| equipment | `via-ferrata` | not drawn | rare; use Traverse line |
| equipment | `walkway` | symbol (new) | `SYM_WALKWAY` |
| equipment | `wheelchair` | not drawn | access notes belong in a callout |
| passage ends | `breakdown-choke` | symbol (new) | `SYM_BREAKDOWN_CHOKE` |
| passage ends | `clay-choke` | symbol (new) | `SYM_CLAY_CHOKE` |
| passage ends | `continuation` | symbol (new) | `SYM_CONTINUATION` |
| passage ends | `entrance` | symbol (existing) | `SYM_ENTRANCE` |
| passage ends | `flowstone-choke` | symbol (new) | `SYM_FLOWSTONE_CHOKE` |
| passage ends | `low-end` | symbol (new) | `SYM_LOW_END` |
| passage ends | `narrow-end` | symbol (new) | `SYM_NARROW_END` |
| others | `air-draught` | symbol (new) | `SYM_AIR_DRAUGHT` |
| others | `altar` | symbol (new) | `SYM_ALTAR` |
| others | `archeo-excavation` | symbol (new) | `SYM_ARCHEO_EXCAVATION` |
| others | `archeo-material` | symbol (new) | `SYM_ARCHEO_MATERIAL` |
| others | `audio` | not drawn | no cave-map use |
| others | `bat` | symbol (new) | `SYM_BAT` |
| others | `bones` | symbol (new) | `SYM_BONES`; also an Area Fill |
| others | `borehole` | not drawn | rare; use Pit |
| others | `danger` | symbol (new) | `SYM_DANGER` |
| others | `dig` | symbol (new) | `SYM_DIG` |
| others | `electric-light` | not drawn | rare; use a callout |
| others | `ex-voto` | symbol (new) | `SYM_EX_VOTO` |
| others | `extra` | not drawn | editor scaffolding |
| others | `gradient` | symbol (existing) | `SYM_SLOPE_TICK` |
| others | `human-bones` | symbol (new) | `SYM_HUMAN_BONES` |
| others | `ice-pillar` | symbol (existing) | `SYM_COLUMN` |
| others | `ice-stalactite` | symbol (existing) | `SYM_STALACTITE` |
| others | `ice-stalagmite` | symbol (existing) | `SYM_STALAGMITE` |
| others | `map-connection` | not drawn | virtual point for shifted maps |
| others | `paleo-material` | symbol (new) | `SYM_PALEO_MATERIAL` |
| others | `photo` | not drawn | no cave-map use |
| others | `root` | symbol (new) | `SYM_ROOT` |
| others | `seed-germination` | symbol (new) | `SYM_SEED_GERMINATION` |
| others | `sink` | not drawn | use Spring with a reversed flow arrow |
| others | `spring` | symbol (existing) | `SYM_SPRING` |
| others | `water-flow` | symbol (existing) | `SYM_FLOW_ARROW` |
| others | `tree-trunk` | symbol (new) | `SYM_TREE_TRUNK` |
| others | `vegetable-debris` | symbol (new) | `SYM_VEGETABLE_DEBRIS` |
| others | `water-drip` | symbol (existing) | `SYM_DRIP_SEEP` |

## Added in this audit

| Block | Name | Category | Layer |
|---|---|---|---|
| `SYM_BAT` | Bat | Biology | BIOLOGY |
| `SYM_ROOT` | Root | Biology | BIOLOGY |
| `SYM_TREE_TRUNK` | Tree trunk | Biology | BIOLOGY |
| `SYM_VEGETABLE_DEBRIS` | Vegetable debris | Biology | BIOLOGY |
| `SYM_SEED_GERMINATION` | Seed germination | Biology | BIOLOGY |
| `SYM_ARCHEO_EXCAVATION` | Archaeological excavation | Archaeology | ARCHAEOLOGY |
| `SYM_ARCHEO_MATERIAL` | Archaeological material | Archaeology | ARCHAEOLOGY |
| `SYM_PALEO_MATERIAL` | Palaeontological material | Archaeology | ARCHAEOLOGY |
| `SYM_BONES` | Bones | Archaeology | ARCHAEOLOGY |
| `SYM_HUMAN_BONES` | Human bones | Archaeology | ARCHAEOLOGY |
| `SYM_MASONRY` | Masonry | Archaeology | ARCHAEOLOGY |
| `SYM_ALTAR` | Altar | Archaeology | ARCHAEOLOGY |
| `SYM_EX_VOTO` | Ex-voto | Archaeology | ARCHAEOLOGY |
| `SYM_DANGER` | Danger | Hazards | NOTES-HAZARD |
| `SYM_DIG` | Dig | Hazards | NOTES-DIG |
| `SYM_AIR_DRAUGHT` | Air draught | Hazards | NOTES-ANNOTATION |
| `SYM_CONTINUATION` | Continuation | Passage ends | NOTES-DIG |
| `SYM_LOW_END` | Low end | Passage ends | NOTES-ANNOTATION |
| `SYM_NARROW_END` | Narrow end | Passage ends | NOTES-ANNOTATION |
| `SYM_BREAKDOWN_CHOKE` | Breakdown choke | Passage ends | BREAKDOWN |
| `SYM_CLAY_CHOKE` | Clay choke | Passage ends | SEDIMENT-CLAY-MUD |
| `SYM_FLOWSTONE_CHOKE` | Flowstone choke | Passage ends | FORMATIONS-FLOWSTONE |
| `SYM_HELICTITE` | Helictite | Formations | FORMATIONS-MOONMILK-POPCORN |
| `SYM_SODA_STRAW` | Soda straw | Formations | FORMATIONS-DRIP |
| `SYM_PENDANT` | Pendant | Formations | FORMATIONS-DRIP |
| `SYM_CAVE_PEARL` | Cave pearls | Formations | FORMATIONS-MOONMILK-POPCORN |
| `SYM_CRYSTAL` | Crystal | Formations | FORMATIONS-MOONMILK-POPCORN |
| `SYM_ARAGONITE` | Aragonite | Formations | FORMATIONS-MOONMILK-POPCORN |
| `SYM_GYPSUM` | Gypsum | Formations | FORMATIONS-MOONMILK-POPCORN |
| `SYM_GYPSUM_FLOWER` | Gypsum flower | Formations | FORMATIONS-MOONMILK-POPCORN |
| `SYM_VOLCANO` | Volcano | Formations | FORMATIONS-DRIP |
| `SYM_CLAY_TREE` | Clay tree | Formations | SEDIMENT-CLAY-MUD |
| `SYM_SCALLOP` | Scallops | Geology | GEOLOGY-JOINTS-FRACTURES |
| `SYM_FLUTE` | Flutes | Geology | GEOLOGY-JOINTS-FRACTURES |
| `SYM_KARREN` | Karren | Geology | GEOLOGY-JOINTS-FRACTURES |
| `SYM_ANASTOMOSIS` | Anastomosis | Geology | GEOLOGY-JOINTS-FRACTURES |
| `SYM_BRIDGE` | Bridge | Rigging | ANCHORS-BOLTS |
| `SYM_WALKWAY` | Walkway | Rigging | ANCHORS-BOLTS |
| `SYM_HANDRAIL` | Handrail | Rigging | ANCHORS-BOLTS |
| `SYM_STEPS` | Steps | Rigging | ANCHORS-BOLTS |
| `SYM_FIXED_LADDER` | Fixed ladder | Rigging | ANCHORS-BOLTS |
| `SYM_GATE` | Gate | Rigging | ANCHORS-BOLTS |
| `SYM_CAMP` | Camp | Rigging | ANCHORS-BOLTS |
| `SYM_NAMEPLATE` | Name plate | Rigging | ANCHORS-BOLTS |

## Still open

- Ice formations (`ice-stalactite`, `ice-stalagmite`, `ice-pillar`) share the dripstone glyphs.
- Plural forms place as the singular glyph, one symbol, not a cluster.
- `raft` (floating calcite rafts) has no glyph.
- UIS and NSS define no point symbol that Therion lacks, apart from the rigging set already shipped.
