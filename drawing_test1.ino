#include <Adafruit_GFX.h>
#include <MCUFRIEND_kbv.h>

MCUFRIEND_kbv tft;

void setup() {
  Serial.begin(115200); 
  
  uint16_t ID = tft.readID();
  if (ID == 0xD3D3) ID = 0x9486; 
  tft.begin(ID);
  
  tft.setRotation(1); // Set to landscape
  tft.fillScreen(0xFFFF); // Clear screen to White
}

void loop() {
  if (Serial.available() > 0) {
    char cmd = Serial.read();
    
    if (cmd == 'I') {
      // Send screen info: 'I', width_high, width_low, height_high, height_low
      uint16_t w = tft.width();
      uint16_t h = tft.height();
      Serial.write('I');
      Serial.write((w >> 8) & 0xFF);
      Serial.write(w & 0xFF);
      Serial.write((h >> 8) & 0xFF);
      Serial.write(h & 0xFF);
    } 
    else if (cmd == 'S') { 
      uint16_t screenWidth = tft.width();
      uint16_t screenHeight = tft.height();
      uint32_t totalPixelsExpected = (uint32_t)screenWidth * screenHeight;
      uint32_t totalPixels = 0;
      int x = 0, y = 0;
      int runsReceived = 0;

      while (totalPixels < totalPixelsExpected) {
        uint32_t startWait = millis();
        // Wait for a 4-byte RLE Packet [Count High, Count Low, Color High, Color Low]
        while (Serial.available() < 4) { 
          if (millis() - startWait > 3000) return; // Prevent freezing if cable unplugs
        } 
        
        uint8_t countH = Serial.read();
        uint8_t countL = Serial.read();
        uint8_t colorH = Serial.read();
        uint8_t colorL = Serial.read();
        
        uint16_t count = (countH << 8) | countL;
        uint16_t color = (colorH << 8) | colorL;
        
        totalPixels += count;

        // Hardware-Accelerated Rendering Algorithm
        // Draws chunks as ultra-fast horizontal strips
        while (count > 0) {
            uint16_t pixelsLeftInRow = screenWidth - x;
            uint16_t drawCount = (count < pixelsLeftInRow) ? count : pixelsLeftInRow;
            
            // Instantly fill the calculated block
            tft.fillRect(x, y, drawCount, 1, color);
            
            x += drawCount;
            if (x >= screenWidth) { 
                x = 0; 
                y++; 
            }
            count -= drawCount;
        }

        runsReceived++;
        if (runsReceived == 16 || totalPixels >= totalPixelsExpected) {
          Serial.write('K'); // Send ACK
          runsReceived = 0;
        }
      }
    }
    else if (cmd == 'C') { // Circle (used for brush dots)
      while (Serial.available() < 9); // Wait for 9 bytes
      int x = (Serial.read() << 8) | Serial.read();
      int y = (Serial.read() << 8) | Serial.read();
      int r = Serial.read();
      int color = (Serial.read() << 8) | Serial.read();
      tft.fillCircle(x, y, r, color);
    }
    else if (cmd == 'L') { // Line (used for strokes)
      while (Serial.available() < 10); // Wait for 10 bytes
      int x1 = (Serial.read() << 8) | Serial.read();
      int y1 = (Serial.read() << 8) | Serial.read();
      int x2 = (Serial.read() << 8) | Serial.read();
      int y2 = (Serial.read() << 8) | Serial.read();
      int color = (Serial.read() << 8) | Serial.read();
      tft.drawLine(x1, y1, x2, y2, color);
    }
    else if (cmd == 'R') { // Rectangle
      while (Serial.available() < 10); // Wait for 10 bytes
      int x = (Serial.read() << 8) | Serial.read();
      int y = (Serial.read() << 8) | Serial.read();
      int w = (Serial.read() << 8) | Serial.read();
      int h = (Serial.read() << 8) | Serial.read();
      int color = (Serial.read() << 8) | Serial.read();
      tft.drawRect(x, y, w, h, color);
    }
    else if (cmd == 'F') { // Fill Rectangle
      while (Serial.available() < 10); // Wait for 10 bytes
      int x = (Serial.read() << 8) | Serial.read();
      int y = (Serial.read() << 8) | Serial.read();
      int w = (Serial.read() << 8) | Serial.read();
      int h = (Serial.read() << 8) | Serial.read();
      int color = (Serial.read() << 8) | Serial.read();
      tft.fillRect(x, y, w, h, color);
    }
    else if (cmd == 'E') { // Erase/Fill Screen
      while (Serial.available() < 2); // Wait for 2 bytes
      int color = (Serial.read() << 8) | Serial.read();
      tft.fillScreen(color);
    }
  }
}