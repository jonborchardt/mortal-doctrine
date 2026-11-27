import { InputBit, type FrameInputs } from '@mortal-doctrine/sim-core';
import { describe, expect, it } from 'vitest';
import {
  arenaRulesSchema,
  DEFAULT_ARENA_RULES,
  DEFAULT_MOVEMENT_PARAMETERS,
  initialMovement,
  movementParametersSchema,
  type MovementParameters,
} from '../src/index';
import { RAMPED_MOVEMENT_PARAMETERS, runMovement } from '../src/testing';

const { LEFT, RIGHT, UP, DOWN } = InputBit;

type Row = readonly [
  x: number,
  y: number,
  vx: number,
  vy: number,
  grounded: boolean,
  crouching: boolean,
];

/** Player 1's input per frame; player 2 stands still at x 72000, far from every motion. */
const MOTIONS = {
  walkForward: { frames: 24, input: (f: number) => (f < 10 ? RIGHT : 0) },
  walkBack: { frames: 18, input: (f: number) => (f < 8 ? LEFT : 0) },
  crouch: { frames: 27, input: (f: number) => (f < 10 ? RIGHT : f < 24 ? DOWN : 0) },
  neutralJump: { frames: 42, input: (f: number) => (f === 0 ? UP : 0) },
  forwardJump: { frames: 56, input: (f: number) => (f === 0 ? UP | RIGHT : 0) },
  backJump: { frames: 52, input: (f: number) => (f === 0 ? UP | LEFT : 0) },
} as const;
type Motion = keyof typeof MOTIONS;

/*
 * Player 1's state after every tick, [x, y, vx, vy, grounded, crouching], from x 24000 facing
 * right. Literals come from an independent reference calculation of the per-tick rule in the
 * README (not this package's code). Default: instant walk at 400; jumpVelocity 1950, gravity
 * 100, jump speeds 500, so the apex is 20000 on tick 20 and the landing is exactly y = 0 on
 * tick 40; the 500 landing slide stops in two ticks. Ramped: acceleration 70 ramps to 500
 * forward (tick 8) and 300 back (tick 5), friction 45 stops in 12 / 7 ticks (also while
 * crouching); jumpVelocity 1750, gravity 90: apex 17900 on tick 20, tick 40 would reach
 * y = -200 and lands at 0; the landing keeps vx and slides.
 */
const TABLES: Record<'default' | 'ramped', Record<Motion, readonly Row[]>> = {
  default: {
    walkForward: [
      [24400, 0, 400, 0, true, false],
      [24800, 0, 400, 0, true, false],
      [25200, 0, 400, 0, true, false],
      [25600, 0, 400, 0, true, false],
      [26000, 0, 400, 0, true, false],
      [26400, 0, 400, 0, true, false],
      [26800, 0, 400, 0, true, false],
      [27200, 0, 400, 0, true, false],
      [27600, 0, 400, 0, true, false],
      [28000, 0, 400, 0, true, false],
      [28000, 0, 0, 0, true, false],
      [28000, 0, 0, 0, true, false],
      [28000, 0, 0, 0, true, false],
      [28000, 0, 0, 0, true, false],
      [28000, 0, 0, 0, true, false],
      [28000, 0, 0, 0, true, false],
      [28000, 0, 0, 0, true, false],
      [28000, 0, 0, 0, true, false],
      [28000, 0, 0, 0, true, false],
      [28000, 0, 0, 0, true, false],
      [28000, 0, 0, 0, true, false],
      [28000, 0, 0, 0, true, false],
      [28000, 0, 0, 0, true, false],
      [28000, 0, 0, 0, true, false],
    ],
    walkBack: [
      [23600, 0, -400, 0, true, false],
      [23200, 0, -400, 0, true, false],
      [22800, 0, -400, 0, true, false],
      [22400, 0, -400, 0, true, false],
      [22000, 0, -400, 0, true, false],
      [21600, 0, -400, 0, true, false],
      [21200, 0, -400, 0, true, false],
      [20800, 0, -400, 0, true, false],
      [20800, 0, 0, 0, true, false],
      [20800, 0, 0, 0, true, false],
      [20800, 0, 0, 0, true, false],
      [20800, 0, 0, 0, true, false],
      [20800, 0, 0, 0, true, false],
      [20800, 0, 0, 0, true, false],
      [20800, 0, 0, 0, true, false],
      [20800, 0, 0, 0, true, false],
      [20800, 0, 0, 0, true, false],
      [20800, 0, 0, 0, true, false],
    ],
    crouch: [
      [24400, 0, 400, 0, true, false],
      [24800, 0, 400, 0, true, false],
      [25200, 0, 400, 0, true, false],
      [25600, 0, 400, 0, true, false],
      [26000, 0, 400, 0, true, false],
      [26400, 0, 400, 0, true, false],
      [26800, 0, 400, 0, true, false],
      [27200, 0, 400, 0, true, false],
      [27600, 0, 400, 0, true, false],
      [28000, 0, 400, 0, true, false],
      [28000, 0, 0, 0, true, true],
      [28000, 0, 0, 0, true, true],
      [28000, 0, 0, 0, true, true],
      [28000, 0, 0, 0, true, true],
      [28000, 0, 0, 0, true, true],
      [28000, 0, 0, 0, true, true],
      [28000, 0, 0, 0, true, true],
      [28000, 0, 0, 0, true, true],
      [28000, 0, 0, 0, true, true],
      [28000, 0, 0, 0, true, true],
      [28000, 0, 0, 0, true, true],
      [28000, 0, 0, 0, true, true],
      [28000, 0, 0, 0, true, true],
      [28000, 0, 0, 0, true, true],
      [28000, 0, 0, 0, true, false],
      [28000, 0, 0, 0, true, false],
      [28000, 0, 0, 0, true, false],
    ],
    neutralJump: [
      [24000, 1950, 0, 1950, false, false],
      [24000, 3800, 0, 1850, false, false],
      [24000, 5550, 0, 1750, false, false],
      [24000, 7200, 0, 1650, false, false],
      [24000, 8750, 0, 1550, false, false],
      [24000, 10200, 0, 1450, false, false],
      [24000, 11550, 0, 1350, false, false],
      [24000, 12800, 0, 1250, false, false],
      [24000, 13950, 0, 1150, false, false],
      [24000, 15000, 0, 1050, false, false],
      [24000, 15950, 0, 950, false, false],
      [24000, 16800, 0, 850, false, false],
      [24000, 17550, 0, 750, false, false],
      [24000, 18200, 0, 650, false, false],
      [24000, 18750, 0, 550, false, false],
      [24000, 19200, 0, 450, false, false],
      [24000, 19550, 0, 350, false, false],
      [24000, 19800, 0, 250, false, false],
      [24000, 19950, 0, 150, false, false],
      [24000, 20000, 0, 50, false, false],
      [24000, 19950, 0, -50, false, false],
      [24000, 19800, 0, -150, false, false],
      [24000, 19550, 0, -250, false, false],
      [24000, 19200, 0, -350, false, false],
      [24000, 18750, 0, -450, false, false],
      [24000, 18200, 0, -550, false, false],
      [24000, 17550, 0, -650, false, false],
      [24000, 16800, 0, -750, false, false],
      [24000, 15950, 0, -850, false, false],
      [24000, 15000, 0, -950, false, false],
      [24000, 13950, 0, -1050, false, false],
      [24000, 12800, 0, -1150, false, false],
      [24000, 11550, 0, -1250, false, false],
      [24000, 10200, 0, -1350, false, false],
      [24000, 8750, 0, -1450, false, false],
      [24000, 7200, 0, -1550, false, false],
      [24000, 5550, 0, -1650, false, false],
      [24000, 3800, 0, -1750, false, false],
      [24000, 1950, 0, -1850, false, false],
      [24000, 0, 0, 0, true, false],
      [24000, 0, 0, 0, true, false],
      [24000, 0, 0, 0, true, false],
    ],
    forwardJump: [
      [24500, 1950, 500, 1950, false, false],
      [25000, 3800, 500, 1850, false, false],
      [25500, 5550, 500, 1750, false, false],
      [26000, 7200, 500, 1650, false, false],
      [26500, 8750, 500, 1550, false, false],
      [27000, 10200, 500, 1450, false, false],
      [27500, 11550, 500, 1350, false, false],
      [28000, 12800, 500, 1250, false, false],
      [28500, 13950, 500, 1150, false, false],
      [29000, 15000, 500, 1050, false, false],
      [29500, 15950, 500, 950, false, false],
      [30000, 16800, 500, 850, false, false],
      [30500, 17550, 500, 750, false, false],
      [31000, 18200, 500, 650, false, false],
      [31500, 18750, 500, 550, false, false],
      [32000, 19200, 500, 450, false, false],
      [32500, 19550, 500, 350, false, false],
      [33000, 19800, 500, 250, false, false],
      [33500, 19950, 500, 150, false, false],
      [34000, 20000, 500, 50, false, false],
      [34500, 19950, 500, -50, false, false],
      [35000, 19800, 500, -150, false, false],
      [35500, 19550, 500, -250, false, false],
      [36000, 19200, 500, -350, false, false],
      [36500, 18750, 500, -450, false, false],
      [37000, 18200, 500, -550, false, false],
      [37500, 17550, 500, -650, false, false],
      [38000, 16800, 500, -750, false, false],
      [38500, 15950, 500, -850, false, false],
      [39000, 15000, 500, -950, false, false],
      [39500, 13950, 500, -1050, false, false],
      [40000, 12800, 500, -1150, false, false],
      [40500, 11550, 500, -1250, false, false],
      [41000, 10200, 500, -1350, false, false],
      [41500, 8750, 500, -1450, false, false],
      [42000, 7200, 500, -1550, false, false],
      [42500, 5550, 500, -1650, false, false],
      [43000, 3800, 500, -1750, false, false],
      [43500, 1950, 500, -1850, false, false],
      [44000, 0, 500, 0, true, false],
      [44100, 0, 100, 0, true, false],
      [44100, 0, 0, 0, true, false],
      [44100, 0, 0, 0, true, false],
      [44100, 0, 0, 0, true, false],
      [44100, 0, 0, 0, true, false],
      [44100, 0, 0, 0, true, false],
      [44100, 0, 0, 0, true, false],
      [44100, 0, 0, 0, true, false],
      [44100, 0, 0, 0, true, false],
      [44100, 0, 0, 0, true, false],
      [44100, 0, 0, 0, true, false],
      [44100, 0, 0, 0, true, false],
      [44100, 0, 0, 0, true, false],
      [44100, 0, 0, 0, true, false],
      [44100, 0, 0, 0, true, false],
      [44100, 0, 0, 0, true, false],
    ],
    backJump: [
      [23500, 1950, -500, 1950, false, false],
      [23000, 3800, -500, 1850, false, false],
      [22500, 5550, -500, 1750, false, false],
      [22000, 7200, -500, 1650, false, false],
      [21500, 8750, -500, 1550, false, false],
      [21000, 10200, -500, 1450, false, false],
      [20500, 11550, -500, 1350, false, false],
      [20000, 12800, -500, 1250, false, false],
      [19500, 13950, -500, 1150, false, false],
      [19000, 15000, -500, 1050, false, false],
      [18500, 15950, -500, 950, false, false],
      [18000, 16800, -500, 850, false, false],
      [17500, 17550, -500, 750, false, false],
      [17000, 18200, -500, 650, false, false],
      [16500, 18750, -500, 550, false, false],
      [16000, 19200, -500, 450, false, false],
      [15500, 19550, -500, 350, false, false],
      [15000, 19800, -500, 250, false, false],
      [14500, 19950, -500, 150, false, false],
      [14000, 20000, -500, 50, false, false],
      [13500, 19950, -500, -50, false, false],
      [13000, 19800, -500, -150, false, false],
      [12500, 19550, -500, -250, false, false],
      [12000, 19200, -500, -350, false, false],
      [11500, 18750, -500, -450, false, false],
      [11000, 18200, -500, -550, false, false],
      [10500, 17550, -500, -650, false, false],
      [10000, 16800, -500, -750, false, false],
      [9500, 15950, -500, -850, false, false],
      [9000, 15000, -500, -950, false, false],
      [8500, 13950, -500, -1050, false, false],
      [8000, 12800, -500, -1150, false, false],
      [7500, 11550, -500, -1250, false, false],
      [7000, 10200, -500, -1350, false, false],
      [6500, 8750, -500, -1450, false, false],
      [6000, 7200, -500, -1550, false, false],
      [5500, 5550, -500, -1650, false, false],
      [5000, 3800, -500, -1750, false, false],
      [4500, 1950, -500, -1850, false, false],
      [4000, 0, -500, 0, true, false],
      [3900, 0, -100, 0, true, false],
      [3900, 0, 0, 0, true, false],
      [3900, 0, 0, 0, true, false],
      [3900, 0, 0, 0, true, false],
      [3900, 0, 0, 0, true, false],
      [3900, 0, 0, 0, true, false],
      [3900, 0, 0, 0, true, false],
      [3900, 0, 0, 0, true, false],
      [3900, 0, 0, 0, true, false],
      [3900, 0, 0, 0, true, false],
      [3900, 0, 0, 0, true, false],
      [3900, 0, 0, 0, true, false],
    ],
  },
  ramped: {
    walkForward: [
      [24070, 0, 70, 0, true, false],
      [24210, 0, 140, 0, true, false],
      [24420, 0, 210, 0, true, false],
      [24700, 0, 280, 0, true, false],
      [25050, 0, 350, 0, true, false],
      [25470, 0, 420, 0, true, false],
      [25960, 0, 490, 0, true, false],
      [26460, 0, 500, 0, true, false],
      [26960, 0, 500, 0, true, false],
      [27460, 0, 500, 0, true, false],
      [27915, 0, 455, 0, true, false],
      [28325, 0, 410, 0, true, false],
      [28690, 0, 365, 0, true, false],
      [29010, 0, 320, 0, true, false],
      [29285, 0, 275, 0, true, false],
      [29515, 0, 230, 0, true, false],
      [29700, 0, 185, 0, true, false],
      [29840, 0, 140, 0, true, false],
      [29935, 0, 95, 0, true, false],
      [29985, 0, 50, 0, true, false],
      [29990, 0, 5, 0, true, false],
      [29990, 0, 0, 0, true, false],
      [29990, 0, 0, 0, true, false],
      [29990, 0, 0, 0, true, false],
    ],
    walkBack: [
      [23930, 0, -70, 0, true, false],
      [23790, 0, -140, 0, true, false],
      [23580, 0, -210, 0, true, false],
      [23300, 0, -280, 0, true, false],
      [23000, 0, -300, 0, true, false],
      [22700, 0, -300, 0, true, false],
      [22400, 0, -300, 0, true, false],
      [22100, 0, -300, 0, true, false],
      [21845, 0, -255, 0, true, false],
      [21635, 0, -210, 0, true, false],
      [21470, 0, -165, 0, true, false],
      [21350, 0, -120, 0, true, false],
      [21275, 0, -75, 0, true, false],
      [21245, 0, -30, 0, true, false],
      [21245, 0, 0, 0, true, false],
      [21245, 0, 0, 0, true, false],
      [21245, 0, 0, 0, true, false],
      [21245, 0, 0, 0, true, false],
    ],
    crouch: [
      [24070, 0, 70, 0, true, false],
      [24210, 0, 140, 0, true, false],
      [24420, 0, 210, 0, true, false],
      [24700, 0, 280, 0, true, false],
      [25050, 0, 350, 0, true, false],
      [25470, 0, 420, 0, true, false],
      [25960, 0, 490, 0, true, false],
      [26460, 0, 500, 0, true, false],
      [26960, 0, 500, 0, true, false],
      [27460, 0, 500, 0, true, false],
      [27915, 0, 455, 0, true, true],
      [28325, 0, 410, 0, true, true],
      [28690, 0, 365, 0, true, true],
      [29010, 0, 320, 0, true, true],
      [29285, 0, 275, 0, true, true],
      [29515, 0, 230, 0, true, true],
      [29700, 0, 185, 0, true, true],
      [29840, 0, 140, 0, true, true],
      [29935, 0, 95, 0, true, true],
      [29985, 0, 50, 0, true, true],
      [29990, 0, 5, 0, true, true],
      [29990, 0, 0, 0, true, true],
      [29990, 0, 0, 0, true, true],
      [29990, 0, 0, 0, true, true],
      [29990, 0, 0, 0, true, false],
      [29990, 0, 0, 0, true, false],
      [29990, 0, 0, 0, true, false],
    ],
    neutralJump: [
      [24000, 1750, 0, 1750, false, false],
      [24000, 3410, 0, 1660, false, false],
      [24000, 4980, 0, 1570, false, false],
      [24000, 6460, 0, 1480, false, false],
      [24000, 7850, 0, 1390, false, false],
      [24000, 9150, 0, 1300, false, false],
      [24000, 10360, 0, 1210, false, false],
      [24000, 11480, 0, 1120, false, false],
      [24000, 12510, 0, 1030, false, false],
      [24000, 13450, 0, 940, false, false],
      [24000, 14300, 0, 850, false, false],
      [24000, 15060, 0, 760, false, false],
      [24000, 15730, 0, 670, false, false],
      [24000, 16310, 0, 580, false, false],
      [24000, 16800, 0, 490, false, false],
      [24000, 17200, 0, 400, false, false],
      [24000, 17510, 0, 310, false, false],
      [24000, 17730, 0, 220, false, false],
      [24000, 17860, 0, 130, false, false],
      [24000, 17900, 0, 40, false, false],
      [24000, 17850, 0, -50, false, false],
      [24000, 17710, 0, -140, false, false],
      [24000, 17480, 0, -230, false, false],
      [24000, 17160, 0, -320, false, false],
      [24000, 16750, 0, -410, false, false],
      [24000, 16250, 0, -500, false, false],
      [24000, 15660, 0, -590, false, false],
      [24000, 14980, 0, -680, false, false],
      [24000, 14210, 0, -770, false, false],
      [24000, 13350, 0, -860, false, false],
      [24000, 12400, 0, -950, false, false],
      [24000, 11360, 0, -1040, false, false],
      [24000, 10230, 0, -1130, false, false],
      [24000, 9010, 0, -1220, false, false],
      [24000, 7700, 0, -1310, false, false],
      [24000, 6300, 0, -1400, false, false],
      [24000, 4810, 0, -1490, false, false],
      [24000, 3230, 0, -1580, false, false],
      [24000, 1560, 0, -1670, false, false],
      [24000, 0, 0, 0, true, false],
      [24000, 0, 0, 0, true, false],
      [24000, 0, 0, 0, true, false],
    ],
    forwardJump: [
      [24600, 1750, 600, 1750, false, false],
      [25200, 3410, 600, 1660, false, false],
      [25800, 4980, 600, 1570, false, false],
      [26400, 6460, 600, 1480, false, false],
      [27000, 7850, 600, 1390, false, false],
      [27600, 9150, 600, 1300, false, false],
      [28200, 10360, 600, 1210, false, false],
      [28800, 11480, 600, 1120, false, false],
      [29400, 12510, 600, 1030, false, false],
      [30000, 13450, 600, 940, false, false],
      [30600, 14300, 600, 850, false, false],
      [31200, 15060, 600, 760, false, false],
      [31800, 15730, 600, 670, false, false],
      [32400, 16310, 600, 580, false, false],
      [33000, 16800, 600, 490, false, false],
      [33600, 17200, 600, 400, false, false],
      [34200, 17510, 600, 310, false, false],
      [34800, 17730, 600, 220, false, false],
      [35400, 17860, 600, 130, false, false],
      [36000, 17900, 600, 40, false, false],
      [36600, 17850, 600, -50, false, false],
      [37200, 17710, 600, -140, false, false],
      [37800, 17480, 600, -230, false, false],
      [38400, 17160, 600, -320, false, false],
      [39000, 16750, 600, -410, false, false],
      [39600, 16250, 600, -500, false, false],
      [40200, 15660, 600, -590, false, false],
      [40800, 14980, 600, -680, false, false],
      [41400, 14210, 600, -770, false, false],
      [42000, 13350, 600, -860, false, false],
      [42600, 12400, 600, -950, false, false],
      [43200, 11360, 600, -1040, false, false],
      [43800, 10230, 600, -1130, false, false],
      [44400, 9010, 600, -1220, false, false],
      [45000, 7700, 600, -1310, false, false],
      [45600, 6300, 600, -1400, false, false],
      [46200, 4810, 600, -1490, false, false],
      [46800, 3230, 600, -1580, false, false],
      [47400, 1560, 600, -1670, false, false],
      [48000, 0, 600, 0, true, false],
      [48555, 0, 555, 0, true, false],
      [49065, 0, 510, 0, true, false],
      [49530, 0, 465, 0, true, false],
      [49950, 0, 420, 0, true, false],
      [50325, 0, 375, 0, true, false],
      [50655, 0, 330, 0, true, false],
      [50940, 0, 285, 0, true, false],
      [51180, 0, 240, 0, true, false],
      [51375, 0, 195, 0, true, false],
      [51525, 0, 150, 0, true, false],
      [51630, 0, 105, 0, true, false],
      [51690, 0, 60, 0, true, false],
      [51705, 0, 15, 0, true, false],
      [51705, 0, 0, 0, true, false],
      [51705, 0, 0, 0, true, false],
      [51705, 0, 0, 0, true, false],
    ],
    backJump: [
      [23650, 1750, -350, 1750, false, false],
      [23300, 3410, -350, 1660, false, false],
      [22950, 4980, -350, 1570, false, false],
      [22600, 6460, -350, 1480, false, false],
      [22250, 7850, -350, 1390, false, false],
      [21900, 9150, -350, 1300, false, false],
      [21550, 10360, -350, 1210, false, false],
      [21200, 11480, -350, 1120, false, false],
      [20850, 12510, -350, 1030, false, false],
      [20500, 13450, -350, 940, false, false],
      [20150, 14300, -350, 850, false, false],
      [19800, 15060, -350, 760, false, false],
      [19450, 15730, -350, 670, false, false],
      [19100, 16310, -350, 580, false, false],
      [18750, 16800, -350, 490, false, false],
      [18400, 17200, -350, 400, false, false],
      [18050, 17510, -350, 310, false, false],
      [17700, 17730, -350, 220, false, false],
      [17350, 17860, -350, 130, false, false],
      [17000, 17900, -350, 40, false, false],
      [16650, 17850, -350, -50, false, false],
      [16300, 17710, -350, -140, false, false],
      [15950, 17480, -350, -230, false, false],
      [15600, 17160, -350, -320, false, false],
      [15250, 16750, -350, -410, false, false],
      [14900, 16250, -350, -500, false, false],
      [14550, 15660, -350, -590, false, false],
      [14200, 14980, -350, -680, false, false],
      [13850, 14210, -350, -770, false, false],
      [13500, 13350, -350, -860, false, false],
      [13150, 12400, -350, -950, false, false],
      [12800, 11360, -350, -1040, false, false],
      [12450, 10230, -350, -1130, false, false],
      [12100, 9010, -350, -1220, false, false],
      [11750, 7700, -350, -1310, false, false],
      [11400, 6300, -350, -1400, false, false],
      [11050, 4810, -350, -1490, false, false],
      [10700, 3230, -350, -1580, false, false],
      [10350, 1560, -350, -1670, false, false],
      [10000, 0, -350, 0, true, false],
      [9695, 0, -305, 0, true, false],
      [9435, 0, -260, 0, true, false],
      [9220, 0, -215, 0, true, false],
      [9050, 0, -170, 0, true, false],
      [8925, 0, -125, 0, true, false],
      [8845, 0, -80, 0, true, false],
      [8810, 0, -35, 0, true, false],
      [8810, 0, 0, 0, true, false],
      [8810, 0, 0, 0, true, false],
      [8810, 0, 0, 0, true, false],
      [8810, 0, 0, 0, true, false],
      [8810, 0, 0, 0, true, false],
    ],
  },
};

const SETS: Record<'default' | 'ramped', MovementParameters> = {
  default: DEFAULT_MOVEMENT_PARAMETERS,
  ramped: RAMPED_MOVEMENT_PARAMETERS,
};

function run(params: MovementParameters, input: (frame: number) => number, frames: number) {
  const slice = initialMovement([params, params], DEFAULT_ARENA_RULES);
  const inputs = (frame: number): FrameInputs => [input(frame), 0];
  return runMovement(slice, DEFAULT_ARENA_RULES, inputs, frames);
}

describe('frame tables', () => {
  for (const set of ['default', 'ramped'] as const) {
    for (const motion of Object.keys(MOTIONS) as Motion[]) {
      it(`${set}: ${motion} matches the table on every frame`, () => {
        const { frames, input } = MOTIONS[motion];
        const table = TABLES[set][motion];
        expect(table).toHaveLength(frames);
        const { slices } = run(SETS[set], input, frames);
        const actual = slices.map(([p1]): Row => [
          p1.x,
          p1.y,
          p1.vx,
          p1.vy,
          p1.grounded,
          p1.crouching,
        ]);
        expect(actual).toEqual(table);
        expect(slices.every(([, p2]) => p2.x === 72_000 && p2.vx === 0 && p2.grounded)).toBe(true);
      });
    }
  }

  it('reaches the closed-form apex y_n = n·v − g·n(n−1)/2 at n = floor(v / g) + 1', () => {
    for (const params of [DEFAULT_MOVEMENT_PARAMETERS, RAMPED_MOVEMENT_PARAMETERS]) {
      const { jumpVelocity: v, gravity: g } = params;
      const closed = (n: number) => n * v - (g * n * (n - 1)) / 2;
      const apexTick = Math.floor(v / g) + 1;
      const ys = run(params, MOTIONS.neutralJump.input, 42).slices.map(([p1]) => p1.y);
      expect(Math.max(...ys)).toBe(closed(apexTick));
      expect(ys.indexOf(closed(apexTick))).toBe(apexTick - 1);
      ys.forEach((y, i) => {
        if (y !== 0) expect(y).toBe(closed(i + 1));
      });
    }
    expect(TABLES.default.neutralJump[19]?.[1]).toBe(20_000);
    expect(TABLES.ramped.neutralJump[19]?.[1]).toBe(17_900);
  });
});

describe('no drift', () => {
  it('ramped walk / release / reverse cycles land on closed-form integers and stop exactly', () => {
    // One 94-tick cycle from rest, facing right: forward 20 (70·(1+…+7) + 500·13 = 8460),
    // release 20 (Σ 500 − 45k for k = 1…11 = 2530, then 0), back 34 (−(70·(1+…+4) + 300·30) =
    // −9700), release 20 (−(255 + 210 + 165 + 120 + 75 + 30) = −855): net +435, ending at vx 0.
    const CYCLE = 94;
    const CYCLES = 7;
    const input = (frame: number) => {
      if (frame >= CYCLE * CYCLES) return 0;
      const phase = frame % CYCLE;
      return phase < 20 ? RIGHT : phase < 40 ? 0 : phase < 74 ? LEFT : 0;
    };
    expect(CYCLE * CYCLES).toBeGreaterThanOrEqual(600);
    const { slices } = run(RAMPED_MOVEMENT_PARAMETERS, input, CYCLE * CYCLES + 100);
    for (let n = 1; n <= CYCLES; n++) {
      expect(slices[(n - 1) * CYCLE + 39]?.[0]).toMatchObject({
        x: 24_000 + 435 * (n - 1) + 8460 + 2530,
        vx: 0,
      });
      expect(slices[n * CYCLE - 1]?.[0]).toMatchObject({ x: 24_000 + 435 * n, vx: 0 });
    }
    for (const [p1] of slices.slice(CYCLE * CYCLES - 1)) {
      expect(p1.vx).toBe(0);
      expect(p1.x).toBe(24_000 + 435 * CYCLES);
    }
  });
});

describe('schemas', () => {
  it('accept both placeholder sets and the default arena', () => {
    expect(movementParametersSchema.parse(DEFAULT_MOVEMENT_PARAMETERS)).toEqual(
      DEFAULT_MOVEMENT_PARAMETERS,
    );
    expect(movementParametersSchema.parse(RAMPED_MOVEMENT_PARAMETERS)).toEqual(
      RAMPED_MOVEMENT_PARAMETERS,
    );
    expect(arenaRulesSchema.parse(DEFAULT_ARENA_RULES)).toEqual({ width: 96_000 });
  });

  it('reject odd widths, non-positive or non-integer values and maxSeparation above width', () => {
    const rejects = (path: string[], value: unknown) => {
      const copy = JSON.parse(JSON.stringify(DEFAULT_MOVEMENT_PARAMETERS)) as Record<
        string,
        unknown
      >;
      let node = copy;
      for (const key of path.slice(0, -1)) node = node[key] as Record<string, unknown>;
      node[path.at(-1) ?? ''] = value;
      expect(movementParametersSchema.safeParse(copy).error?.issues[0]?.path).toEqual(path);
    };
    rejects(['pushboxes', 'standing', 'width'], 6001);
    rejects(['walkAcceleration'], 0);
    rejects(['groundFriction'], -1);
    rejects(['gravity'], 1.5);
    rejects(['pushboxes', 'airborne', 'height'], 0);
    expect(
      arenaRulesSchema.safeParse({ width: 1000, maxSeparation: 1001 }).error?.issues[0]?.path,
    ).toEqual(['maxSeparation']);
  });
});
