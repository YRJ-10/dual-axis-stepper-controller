
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <avr/interrupt.h>
// Led
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define SCREEN_ADDRESS 0x3C
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
// pin & button
#define stepPin1 3
#define dirPin1 2
#define stepPin2 9
#define dirPin2 8
#define potPin A0
#define buttonPin 4
// motor
int potValue = 0;
int baseSpeed = 0;
int threshold = 10;
int mode = 0;
bool lastButtonState = HIGH;
bool buttonState;
volatile int steps1 = 500, steps2 = 200;
volatile int stepCount1 = 0, stepCount2 = 0;
bool dirState1 = HIGH, dirState2 = HIGH;
// multiplier motor 2
volatile int speedMultiplier2 = 3; 
void setup() {
  pinMode(stepPin1, OUTPUT);
  pinMode(dirPin1, OUTPUT);
  pinMode(stepPin2, OUTPUT);
  pinMode(dirPin2, OUTPUT);
  pinMode(buttonPin, INPUT_PULLUP);
  Serial.begin(9600);
  if (!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    Serial.println("OLED gagal diinisialisasi");
    for (;;);
  }
  tampilkanMode();
  cli();
  TCCR1A = 0;
  TCCR1B = (1 << WGM12) | (1 << CS10); // ctc mode, prescaler 1
  OCR1A = 500;
  TIMSK1 |= (1 << OCIE1A);
  sei();
}
void loop() {
  buttonState = digitalRead(buttonPin);
  if (buttonState == LOW && lastButtonState == HIGH) {
    mode = (mode + 1) % 11;
    tampilkanMode();
    aturLangkahMotor();
    delay(200);
  }
  lastButtonState = buttonState;
  potValue = analogRead(potPin);
  baseSpeed = map(potValue, 0, 1023, 500, 5000);
  if (potValue < threshold) baseSpeed = 0;
}
ISR(TIMER1_COMPA_vect) {
  if (baseSpeed > 0) {
    int easingRange = 150;
    int effectiveSpeed1 = baseSpeed;
    // easing motor 1
    if (stepCount1 < easingRange)
      effectiveSpeed1 = map(stepCount1, 0, easingRange, baseSpeed / 4, baseSpeed);
    else if (stepCount1 > steps1 - easingRange)
      effectiveSpeed1 = map(steps1 - stepCount1, 0, easingRange, baseSpeed / 4, baseSpeed);
    // motor 1 step
    digitalWrite(stepPin1, HIGH);
    delayMicroseconds(2);
    digitalWrite(stepPin1, LOW);
    stepCount1++;
    if (stepCount1 >= steps1) {
      stepCount1 = 0;
      dirState1 = !dirState1;
      digitalWrite(dirPin1, dirState1);
    }
    // motor 2 more step
    int stepRepeat = speedMultiplier2;
    for (int i = 0; i < stepRepeat; i++) {
      digitalWrite(stepPin2, HIGH);
      delayMicroseconds(2);
      digitalWrite(stepPin2, LOW);
      delayMicroseconds(2); // opsional delay per step
      stepCount2++;
      if (stepCount2 >= steps2) {
        stepCount2 = 0;
        dirState2 = !dirState2;
        digitalWrite(dirPin2, dirState2);
        break; // stop for
      }
    }
    // Update timer interval
    OCR1A = 16000000 / (2 * effectiveSpeed1);
  }
}
void tampilkanMode() {
  display.clearDisplay();
  display.setTextSize(3);
  display.setTextColor(WHITE);
  display.setCursor(20, 20);
  display.print("Mode: ");
  display.print(mode);
  display.display();
}
void aturLangkahMotor() {
  const int modeSteps[][2] = {
    {1000, 2000}, {1500, 2300}, {2000, 2500}, {2300, 2700},
    {2500, 3000}, {800, 4000}, {1500, 4300}, {2000, 4500},
    {2300, 4000}, {2700, 0}, {3000, 0}
  };
  steps1 = modeSteps[mode][0];
  steps2 = modeSteps[mode][1];
}
