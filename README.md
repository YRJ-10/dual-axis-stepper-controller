# dual-axis-stepper-controller

Dual-axis stepper motor controller for a V-rail rig:

- Motor 1 moves the plate forward/backward on the rail.
- Motor 2 rotates the standing wheel/round part back and forth.
- Potentiometer controls global speed.
- Button changes mode.
- OLED shows the active mode and values.

## Files

- `dual-axis-stepper-controller.ino` - Arduino Uno firmware.
- `web-app/` - local browser tuner using USB Serial.

## Tunable Values

Each mode has these values:

- `Step Motor 1` - travel length for rail movement.
- `Step Motor 2` - rotation length for wheel movement.
- `Motor 2 x` - motor 2 speed multiplier.
- `Easing` - slow-start/slow-end range for motor 1.

The potentiometer still controls the live global speed.

## Serial Commands

Firmware command format:

```text
SET mode stepMotor1 stepMotor2 multiplierMotor2 easing
GET mode
DUMP
MODE mode
SAVE
LOAD
```

Example:

```text
SET 0 1000 2000 3 150
SAVE
```

`SAVE` stores all mode settings to EEPROM, so Arduino keeps the values after reset or USB unplug.

## Web App Workflow

1. Upload `dual-axis-stepper-controller.ino` to Arduino Uno.
2. Open the local web app in Chrome or Edge:

```text
http://127.0.0.1:8765/
```

3. Click `Connect`.
4. Select the Arduino serial port.
5. Edit mode values.
6. Click `Send` on the mode being tested.
7. Click `Save EEPROM` when the values are good.

## Default Mode Table

| Mode | Step Motor 1 | Step Motor 2 | Motor 2 x | Easing |
| ---: | -----------: | -----------: | --------: | -----: |
| 0 | 1000 | 2000 | 3 | 150 |
| 1 | 1500 | 2300 | 3 | 150 |
| 2 | 2000 | 2500 | 3 | 150 |
| 3 | 2300 | 2700 | 3 | 150 |
| 4 | 2500 | 3000 | 3 | 150 |
| 5 | 800 | 4000 | 3 | 150 |
| 6 | 1500 | 4300 | 3 | 150 |
| 7 | 2000 | 4500 | 3 | 150 |
| 8 | 2300 | 4000 | 3 | 150 |
| 9 | 2700 | 0 | 3 | 150 |
| 10 | 3000 | 0 | 3 | 150 |
