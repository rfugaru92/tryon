const fs = require('fs');
const { Runware } = require('@runware/sdk-js');

// Read API keys from environment variables (required for Vercel)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RUNWARE_API_KEY = process.env.RUNWARE_API_KEY;


async function runFlowWithBuffers(in1Buffer, in2Buffer) {
    try {
        console.log('🚀 Pornirea testului de flow...\n');

        // PASUL 1: Încărcarea și procesarea imaginii cu OpenAI GPT-5-nano
        console.log('📸 Pasul 1: Analizarea imaginii cu GPT-5-nano...');
        
    // Convertirea în base64 (in1)
    const base64Image = Buffer.isBuffer(in1Buffer) ? in1Buffer.toString('base64') : Buffer.from(in1Buffer).toString('base64');
        
// Alternativă cu Responses API
async function callOpenAI(base64Image, maxTokens = 200) {
    return fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
        model: 'gpt-5-nano',
        // Use the supported 'message' input type for text content
        // Single message input containing both text and image content items
        input: [{
            type: 'message',
            role: 'user',
            content: [
                { type: 'input_text', text: 'describe the clothing in 10 words' },
                { type: 'input_image', image_url: `data:image/jpeg;base64,${base64Image}` }
            ]
        }],
        max_output_tokens: maxTokens,
        reasoning: {
            effort: 'low'
        }
    })
    });
}

// initial call
let openaiResponse = await callOpenAI(base64Image, 200);

// If the request itself failed, throw with status for easier debugging
if (!openaiResponse.ok) {
    const errText = await openaiResponse.text().catch(() => '');
    let parsed = errText;
    try { parsed = JSON.parse(errText); } catch (e) {}
    throw new Error(`OpenAI API error: ${openaiResponse.status} ${openaiResponse.statusText} - ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
}

const openaiData = await openaiResponse.json();
console.log('DEBUG OpenAI response body:', JSON.stringify(openaiData, null, 2));

// If the response is incomplete due to max_output_tokens, retry with a larger limit once
if (openaiData && openaiData.incomplete_details && openaiData.incomplete_details.reason === 'max_output_tokens') {
    console.log('⚠️ OpenAI response incomplete due to token limit — retrying with higher max_output_tokens...');
    const retryResp = await callOpenAI(base64Image, 1024);
    if (!retryResp.ok) {
        const t = await retryResp.text().catch(() => '');
        throw new Error(`OpenAI retry error: ${retryResp.status} ${retryResp.statusText} - ${t}`);
    }
    const retryData = await retryResp.json();
    console.log('DEBUG OpenAI retry response body:', JSON.stringify(retryData, null, 2));
    // prefer the retry's output if it has content
    if (retryData && ((Array.isArray(retryData.output) && retryData.output.length > 0) || retryData.output_text)) {
        Object.assign(openaiData, retryData);
    }
}

// Safely extract a text response from common Responses API shapes
let response_text = '';
if (openaiData.output && Array.isArray(openaiData.output) && openaiData.output.length > 0) {
    // Concatenate any text content we can find
    response_text = openaiData.output.map(o => {
        if (o.content && Array.isArray(o.content)) {
            return o.content.map(c => c.text || c).join(' ');
        }
        return o.text || '';
    }).join(' ').trim();
}
if (!response_text && openaiData.output_text) response_text = String(openaiData.output_text).trim();
if (!response_text && openaiData.choices && openaiData.choices[0] && openaiData.choices[0].message) {
    response_text = String(openaiData.choices[0].message.content || '').trim();
}
if (!response_text) response_text = '';
        
        console.log(`✅ Descrierea vestimentației: "${response_text}"\n`);

        // If the model returned no text, stop and provide debugging info instead of calling Runware
        if (!response_text) {
            console.error('⚠️ OpenAI returned no textual description for the image. Aborting Runware call to avoid empty prompt.');
            console.error('DEBUG OpenAI full response object:', JSON.stringify(openaiData, null, 2));
            throw new Error('OpenAI returned an empty description (no output_text / output). Check image size, model choice, or increase max_output_tokens.');
        }

        // PASUL 2: Folosirea rezultatului cu FLUX Kontext Pro prin Runware
        console.log('🎨 Pasul 2: Editarea imaginii cu FLUX Kontext Pro...');
        
        // Inițializarea clientului Runware
        const runware = new Runware({
            apiKey: RUNWARE_API_KEY,
            shouldReconnect: true,
            globalMaxRetries: 3
        });

        // Încărcarea celei de-a doua imagini
    const base64Image2 = Buffer.isBuffer(in2Buffer) ? in2Buffer.toString('base64') : Buffer.from(in2Buffer).toString('base64');

        // Construirea prompt-ului pentru FLUX Kontext Pro
        const fluxPrompt = `Make the woman wear the ${response_text.toLocaleLowerCase()}. Make sure it fits her perfectly.`;
        console.log(`🔧 Prompt pentru FLUX: "${fluxPrompt}"`);

        // Apel către Runware API pentru editarea imaginii
        const fluxResult = await runware.requestImages({
            taskType: 'imageInference',
            model: 'bfl:3@1', // FLUX.1 Kontext [pro] model ID pentru Runware
            positivePrompt: fluxPrompt,
            referenceImages: [
                `data:image/jpeg;base64,${base64Image2}`,  // in1.jpg ca referință
                `data:image/jpeg;base64,${base64Image}`  // in2.jpg ca bază
            ],
            width: 1024,
            height: 1024,
            numberResults: 1,
            includeCost: true
        });

        // PASUL 3: Afișarea rezultatelor
        console.log('\n🎯 REZULTATELE FINALE:');
        console.log('=' * 50);
        console.log(`📝 Descrierea vestimentației: "${response_text}"`);
        console.log(`🖼️  URL imagine generată: ${fluxResult[0].imageURL}`);
        console.log(`💰 Cost operațiune: $${fluxResult[0].cost || 'N/A'}`);
        console.log(`🆔 UUID imagine: ${fluxResult[0].imageUUID || 'N/A'}`);
        
        console.log('\n✨ Test complet cu succes!');
        
    return {
            description: response_text,
            generatedImageUrl: fluxResult[0].imageURL,
            cost: fluxResult[0].cost,
            imageUUID: fluxResult[0].imageUUID
        };

    } catch (error) {
        console.error('❌ Eroare în timpul testului:', error.message);
        
        // Detalii suplimentare pentru debugging
        if (error.response) {
            console.error('📊 Răspuns API:', error.response.data);
        }
        
        throw error;
    }
}

// Backwards-compatible local flow using files
async function testFlow() {
    const in1 = fs.readFileSync('in1.jpg');
    const in2 = fs.readFileSync('in2.jpg');
    return runFlowWithBuffers(in1, in2);
}

// Funcție pentru verificarea existenței fișierelor
function checkFiles() {
    const requiredFiles = ['in1.jpg', 'in2.jpg'];
    const missingFiles = requiredFiles.filter(file => !fs.existsSync(file));
    
    if (missingFiles.length > 0) {
        console.error('❌ Lipsesc fișierele:', missingFiles.join(', '));
        console.error('💡 Asigură-te că ai imaginile in1.jpg și in2.jpg în același director cu script-ul.');
        return false;
    }
    return true;
}

// Funcție pentru verificarea cheilor API
function checkApiKeys() {
    if (!OPENAI_API_KEY) {
        console.error('❌ Lipsă OPENAI_API_KEY în variabilele de mediu.');
        return false;
    }
    
    if (!RUNWARE_API_KEY) {
        console.error('❌ Lipsă RUNWARE_API_KEY în variabilele de mediu.');
        return false;
    }
    
    return true;
}

// Rularea testului
async function main() {
    console.log('🔍 Verificarea pre-requisitelor...\n');
    
    if (!checkFiles() || !checkApiKeys()) {
        process.exit(1);
    }
    
    console.log('✅ Toate verificările trecute. Pornirea testului...\n');
    
    try {
        const result = await testFlow();
        console.log('\n🎉 Test finalizat cu succes!');
        console.log('📋 Rezultat final:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('\n💥 Testul a eșuat:', error.message);
        process.exit(1);
    }
}

// Exportul pentru utilizare ca modul
module.exports = { testFlow, runFlowWithBuffers, checkFiles, checkApiKeys };

// Rularea directă dacă script-ul este executat
if (require.main === module) {
    main();
}