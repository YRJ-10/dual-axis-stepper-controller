
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <avr/interrupt.h>
#include <EEPROM.h>
#include <string.h>
#include <stdlib.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define SCREEN_ADDRESS 0x3C

#define stepPin1 5
#define dirPin1 2
#define stepPin2 9
#define dirPin2 8
#define potPin A0
#define buttonPin 4

#define MODE_COUNT 11
#define SERIAL_BUFFER_SIZE 64
#define EEPROM_MAGIC 0x44584331UL
#define EEPROM_VERSION 1

struct ModeConfig {
  int steps1;
  int steps2;
  int multiplier2;
  int easing;
};

struct StoredConfig {
  unsigned long magic;
  byte version;
  ModeConfig modes[MODE_COUNT];
};

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

ModeConfig modeConfigs[MODE_COUNT] = {
  {1000, 2000, 3, 150},
  {1500, 2300, 3, 150},
  {2000, 2500, 3, 150},
  {2300, 2700, 3, 150},
  {2500, 3000, 3, 150},
  {800, 4000, 3, 150},
  {1500, 4300, 3, 150},
  {2000, 4500, 3, 150},
  {2300, 4000, 3, 150},
  {2700, 0, 3, 150},
  {3000, 0, 3, 150}
};

int potValue = 0;
const int threshold = 10;
int mode = 0;
bool lastButtonState = HIGH;
bool displayReady = false;

volatile int baseSpeed = 0;
volatile int activeSteps1 = 1000;
volatile int activeSteps2 = 2000;
volatile int activeMultiplier2 = 3;
volatile int activeEasing = 150;
volatile int stepCount1 = 0;
volatile int stepCount2 = 0;
volatile bool dirState1 = HIGH;
volatile bool dirState2 = HIGH;

char serialBuffer[SERIAL_BUFFER_SIZE];
byte serialIndex = 0;
unsigned long lastActiveReportMs = 0;

void setup() {
  pinMode(stepPin1, OUTPUT);
  pinMode(dirPin1, OUTPUT);
  pinMode(stepPin2, OUTPUT);
  pinMode(dirPin2, OUTPUT);
  pinMode(buttonPin, INPUT_PULLUP);

  digitalWrite(dirPin1, dirState1);
  digitalWrite(dirPin2, dirState2);

  Serial.begin(9600);
  Serial.println(F("Dual axis controller ready"));
  Serial.println(F("Commands: SET mode steps1 steps2 multiplier2 easing | GET mode | DUMP | SAVE | LOAD"));

  displayReady = display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS);
  if (!displayReady) {
    Serial.println(F("OLED init failed, controller continues"));
  }

  if (loadConfigsFromEeprom()) {
    Serial.println(F("OK EEPROM loaded"));
  } else {
    Serial.println(F("OK using sketch defaults"));
  }

  applyModeConfig(mode, true);
  tampilkanMode();
  sendActiveMode();

  cli();
  TCCR1A = 0;
  TCCR1B = (1 << WGM12) | (1 << CS10);
  OCR1A = 500;
  TIMSK1 |= (1 << OCIE1A);
  sei();
}

void loop() {
  handleSerial();
  handleButton();
  updateBaseSpeed();
  reportActiveModePeriodically();
}

void handleButton() {
  bool buttonState = digitalRead(buttonPin);
  if (buttonState == LOW && lastButtonState == HIGH) {
    mode = (mode + 1) % MODE_COUNT;
    applyModeConfig(mode, true);
    tampilkanMode();
    sendMode(mode);
    sendActiveMode();
    delay(200);
  }
  lastButtonState = buttonState;
}

void updateBaseSpeed() {
  potValue = analogRead(potPin);
  int nextSpeed = map(potValue, 0, 1023, 500, 5000);
  if (potValue < threshold) {
    nextSpeed = 0;
  }
  baseSpeed = nextSpeed;
}

void handleSerial() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\r') {
      continue;
    }
    if (c == '\n') {
      serialBuffer[serialIndex] = '\0';
      processCommand(serialBuffer);
      serialIndex = 0;
      return;
    }
    if (serialIndex < SERIAL_BUFFER_SIZE - 1) {
      serialBuffer[serialIndex++] = c;
    }
  }
}

void processCommand(char *line) {
  char *cmd = strtok(line, " ");
  if (cmd == NULL) {
    return;
  }
  uppercase(cmd);

  if (strcmp(cmd, "SET") == 0) {
    handleSetCommand();
    return;
  }

  if (strcmp(cmd, "GET") == 0) {
    char *modeToken = strtok(NULL, " ");
    int targetMode = modeToken == NULL ? mode : atoi(modeToken);
    if (!isValidMode(targetMode)) {
      Serial.println(F("ERR mode"));
      return;
    }
    sendMode(targetMode);
    return;
  }

  if (strcmp(cmd, "DUMP") == 0) {
    for (int i = 0; i < MODE_COUNT; i++) {
      sendMode(i);
    }
    Serial.println(F("OK DUMP"));
    sendActiveMode();
    return;
  }

  if (strcmp(cmd, "SAVE") == 0) {
    saveConfigsToEeprom();
    Serial.println(F("OK SAVE"));
    return;
  }

  if (strcmp(cmd, "LOAD") == 0) {
    if (!loadConfigsFromEeprom()) {
      Serial.println(F("ERR EEPROM empty"));
      return;
    }
    applyModeConfig(mode, true);
    tampilkanMode();
    Serial.println(F("OK LOAD"));
    sendMode(mode);
    sendActiveMode();
    return;
  }

  if (strcmp(cmd, "MODE") == 0) {
    char *modeToken = strtok(NULL, " ");
    int nextMode = modeToken == NULL ? mode : atoi(modeToken);
    if (!isValidMode(nextMode)) {
      Serial.println(F("ERR mode"));
      return;
    }
    mode = nextMode;
    applyModeConfig(mode, true);
    tampilkanMode();
    sendMode(mode);
    sendActiveMode();
    return;
  }

  Serial.println(F("ERR command"));
}

void handleSetCommand() {
  char *modeToken = strtok(NULL, " ");
  char *steps1Token = strtok(NULL, " ");
  char *steps2Token = strtok(NULL, " ");
  char *multiplierToken = strtok(NULL, " ");
  char *easingToken = strtok(NULL, " ");

  if (
    modeToken == NULL ||
    steps1Token == NULL ||
    steps2Token == NULL ||
    multiplierToken == NULL ||
    easingToken == NULL
  ) {
    Serial.println(F("ERR SET format"));
    return;
  }

  int targetMode = atoi(modeToken);
  ModeConfig nextConfig = {
    atoi(steps1Token),
    atoi(steps2Token),
    atoi(multiplierToken),
    atoi(easingToken)
  };

  if (!isValidMode(targetMode)) {
    Serial.println(F("ERR mode"));
    return;
  }

  if (!isValidConfig(nextConfig)) {
    Serial.println(F("ERR value"));
    return;
  }

  modeConfigs[targetMode] = nextConfig;
  if (targetMode == mode) {
    applyModeConfig(mode, true);
    tampilkanMode();
    sendActiveMode();
  }

  Serial.print(F("OK SET "));
  Serial.println(targetMode);
  sendMode(targetMode);
}

bool isValidMode(int targetMode) {
  return targetMode >= 0 && targetMode < MODE_COUNT;
}

bool isValidConfig(ModeConfig config) {
  return (
    config.steps1 > 0 &&
    config.steps1 <= 30000 &&
    config.steps2 >= 0 &&
    config.steps2 <= 30000 &&
    config.multiplier2 >= 1 &&
    config.multiplier2 <= 20 &&
    config.easing >= 0 &&
    config.easing <= 5000
  );
}

void applyModeConfig(int targetMode, bool resetCounters) {
  ModeConfig config = modeConfigs[targetMode];
  noInterrupts();
  activeSteps1 = config.steps1;
  activeSteps2 = config.steps2;
  activeMultiplier2 = config.multiplier2;
  activeEasing = config.easing;
  if (resetCounters) {
    stepCount1 = 0;
    stepCount2 = 0;
  }
  interrupts();
}

void sendMode(int targetMode) {
  ModeConfig config = modeConfigs[targetMode];
  Serial.print(F("MODE "));
  Serial.print(targetMode);
  Serial.print(F(" "));
  Serial.print(config.steps1);
  Serial.print(F(" "));
  Serial.print(config.steps2);
  Serial.print(F(" "));
  Serial.print(config.multiplier2);
  Serial.print(F(" "));
  Serial.println(config.easing);
}

void sendActiveMode() {
  Serial.print(F("ACTIVE "));
  Serial.println(mode);
}

void reportActiveModePeriodically() {
  unsigned long now = millis();
  if (now - lastActiveReportMs < 1000) {
    return;
  }
  lastActiveReportMs = now;
  sendActiveMode();
}

void saveConfigsToEeprom() {
  StoredConfig stored;
  stored.magic = EEPROM_MAGIC;
  stored.version = EEPROM_VERSION;
  for (int i = 0; i < MODE_COUNT; i++) {
    stored.modes[i] = modeConfigs[i];
  }
  EEPROM.put(0, stored);
}

bool loadConfigsFromEeprom() {
  StoredConfig stored;
  EEPROM.get(0, stored);

  if (stored.magic != EEPROM_MAGIC || stored.version != EEPROM_VERSION) {
    return false;
  }

  for (int i = 0; i < MODE_COUNT; i++) {
    if (!isValidConfig(stored.modes[i])) {
      return false;
    }
  }

  for (int i = 0; i < MODE_COUNT; i++) {
    modeConfigs[i] = stored.modes[i];
  }
  return true;
}

void uppercase(char *text) {
  for (byte i = 0; text[i] != '\0'; i++) {
    if (text[i] >= 'a' && text[i] <= 'z') {
      text[i] = text[i] - 32;
    }
  }
}

ISR(TIMER1_COMPA_vect) {
  int localBaseSpeed = baseSpeed;
  if (localBaseSpeed <= 0) {
    return;
  }

  int localSteps1 = activeSteps1;
  int localSteps2 = activeSteps2;
  int localMultiplier2 = activeMultiplier2;
  int localEasing = activeEasing;

  if (localSteps1 <= 0) {
    return;
  }

  if (localEasing > localSteps1 / 2) {
    localEasing = localSteps1 / 2;
  }

  int effectiveSpeed1 = localBaseSpeed;
  if (localEasing > 0 && stepCount1 < localEasing) {
    effectiveSpeed1 = map(stepCount1, 0, localEasing, localBaseSpeed / 4, localBaseSpeed);
  } else if (localEasing > 0 && stepCount1 > localSteps1 - localEasing) {
    effectiveSpeed1 = map(localSteps1 - stepCount1, 0, localEasing, localBaseSpeed / 4, localBaseSpeed);
  }

  digitalWrite(stepPin1, HIGH);
  delayMicroseconds(2);
  digitalWrite(stepPin1, LOW);
  stepCount1++;

  if (stepCount1 >= localSteps1) {
    stepCount1 = 0;
    dirState1 = !dirState1;
    digitalWrite(dirPin1, dirState1);
  }

  if (localSteps2 > 0) {
    for (int i = 0; i < localMultiplier2; i++) {
      digitalWrite(stepPin2, HIGH);
      delayMicroseconds(2);
      digitalWrite(stepPin2, LOW);
      delayMicroseconds(2);
      stepCount2++;

      if (stepCount2 >= localSteps2) {
        stepCount2 = 0;
        dirState2 = !dirState2;
        digitalWrite(dirPin2, dirState2);
        break;
      }
    }
  }

  if (effectiveSpeed1 < 1) {
    effectiveSpeed1 = 1;
  }
  OCR1A = 16000000 / (2 * effectiveSpeed1);
}

void tampilkanMode() {
  if (!displayReady) {
    return;
  }

  display.clearDisplay();
  display.setTextColor(WHITE);
  display.setTextSize(3);
  display.setCursor(20, 6);
  display.print(F("M:"));
  display.print(mode);
  display.setTextSize(1);
  display.setCursor(0, 42);
  display.print(F("S1 "));
  display.print(modeConfigs[mode].steps1);
  display.print(F(" S2 "));
  display.print(modeConfigs[mode].steps2);
  display.setCursor(0, 54);
  display.print(F("M2x"));
  display.print(modeConfigs[mode].multiplier2);
  display.print(F(" E "));
  display.print(modeConfigs[mode].easing);
  display.display();
}
