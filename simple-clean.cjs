#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function cleanComments(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    const originalContent = content;
    
    // Split content into lines
    const lines = content.split('\n');
    
    // Filter out lines that start with // (with optional whitespace)
    // But keep layout comments like {/* ... */}
    const cleanedLines = lines.filter(line => {
      const trimmed = line.trim();
      // Keep the line if it doesn't start with //
      // or if it contains layout comment patterns
      return !trimmed.startsWith('//') || 
             trimmed.includes('{/*') || 
             trimmed.includes('*/}');
    });
    
    const cleanedContent = cleanedLines.join('\n');
    
    // Only write if content actually changed
    if (cleanedContent !== originalContent) {
      fs.writeFileSync(filePath, cleanedContent);
      console.log(`Cleaned: ${filePath}`);
      
      // Show what was removed (first few lines for debugging)
      const removedLines = lines.filter(line => {
        const trimmed = line.trim();
        return trimmed.startsWith('//') && 
               !trimmed.includes('{/*') && 
               !trimmed.includes('*/}');
      });
      
      if (removedLines.length > 0) {
        console.log(`  Removed ${removedLines.length} comment lines`);
      }
    } else {
      console.log(`No changes: ${filePath}`);
    }
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
  }
}

function walkDirectory(dir) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stats = fs.statSync(filePath);
    
    if (stats.isDirectory()) {
      // Skip node_modules and .git directories
      if (file === 'node_modules' || file === '.git' || file === '.next') {
        continue;
      }
      walkDirectory(filePath);
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      // Skip type declaration files and config files
      if (file.endsWith('.d.ts') || file === 'tailwind.config.ts' || file === 'next.config.ts') {
        console.log(`Skipped: ${filePath} (config/declaration file)`);
        continue;
      }
      cleanComments(filePath);
    }
  }
}

// Start cleaning from src directory
const srcDir = path.join(__dirname, 'src');
if (fs.existsSync(srcDir)) {
  console.log('Starting simple comment cleanup...');
  console.log('Only removing lines that start with //');
  console.log('Preserving URLs and layout comments');
  console.log('---');
  walkDirectory(srcDir);
  console.log('---');
  console.log('Simple comment cleanup completed!');
} else {
  console.error('src directory not found');
}
