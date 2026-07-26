#!/usr/bin/env node

// Test script to show divider examples
const config = require('./Discord_Bot/config');

function showDividerExamples() {
    console.log('=== CIRCLE RANKING DIVIDER EXAMPLES ===\n');

    // 30-minute update divider
    const regularDivider = '───────────────────────────────────────────────────────────────';
    const regularText = '⏰ **30-MINUTE UPDATE** ⏰';
    
    console.log('📋 Regular 30-minute update:');
    console.log(regularDivider);
    console.log(regularText);
    console.log(regularDivider);
    console.log('\n01. ＬＣω — 4,829 PT ➖');
    console.log('02. ＭＩＫＵ＝☆ω☆＝ — 4,345 PT ⬆️1');
    console.log('03. Ｒａｇｎａｒｏｋｒｚ — 3,317 PT (+50) ⬇️1');
    console.log('...\n');

    // Daily update divider
    const dailyDivider = '═══════════════════════════════════════════════════════════════';
    const dailyText = '🌅 **DAILY CIRCLE RANKINGS UPDATE** 🌅\n📊 **Complete Top 100 Circle Rankings** 📊';
    
    console.log('📋 Daily update (first of the day):');
    console.log(dailyDivider);
    console.log(dailyText);
    console.log(dailyDivider);
    console.log('\n01. ＬＣω — 4,829 PT 🆕');
    console.log('02. ＭＩＫＵ＝☆ω☆＝ — 4,345 PT 🆕');
    console.log('03. Ｒａｇｎａｒｏｋｒｚ — 3,317 PT 🆕');
    console.log('...\n');

    console.log('🎨 Visual differences:');
    console.log('• Regular updates: Blue color (0x7289da) with single line dividers (─)');
    console.log('• Daily updates: Gold color (0xffd700) with double line dividers (═)');
    console.log('• Daily updates include extra description line');
    console.log('• First daily update shows 🆕 for all teams (no previous comparison)');
}

showDividerExamples();