// functions/test-r2.js

/**
 * Cloudflare Pages Function to test the R2 bucket binding.
 * * Assumes the R2 binding variable name is MY_R2_BUCKET.
 * * @param {object} context - The context object provided by Pages Functions.
 * @returns {Response} A standard HTTP response indicating success or failure.
 */
export async function onRequest(context) {
    



    // The variable name MUST exactly match the binding you set in the Pages settings.
    // const bucket = context.env.k1iad-storage; 
    // const bucket = context.env.KLIAD_STORAGE; 



    const bucket = context.env["kliad-storage"];


    

    
    // This is the file the function will attempt to read from your R2 bucket.
    const testKey = 'test-file.txt'; 

    // --- Binding Check ---
    if (!bucket) {
        // This is the cause of the "Cannot read properties of undefined" error.
        return new Response(
            "❌ ERROR: R2 Binding 'MY_R2_BUCKET' is undefined. Ensure the binding is added in Pages Settings and a new deployment was triggered.", 
            { status: 500 }
        );
    }

    // --- R2 Operation Test ---
    try {
        // Attempt to read the object from R2
        const object = await bucket.get(testKey);

        if (object === null) {
            // Binding is working, but the specific file is not there.
            return new Response(
                `✅ Binding is active, but the file "${testKey}" was not found in the bucket.`, 
                { status: 404 }
            );
        }

        // Success: Binding works and the file was found.
        return new Response(
            `✅ SUCCESS! R2 Binding is effective. Key: ${object.key}. Content: ${await object.text()}`,
            {
                status: 200,
                headers: { 'Content-Type': 'text/plain' }
            }
        );

    } catch (error) {
        // Handle unexpected errors during the R2 operation
        return new Response(`❌ R2 Operation Failed: ${error.message}`, { status: 500 });
    }
}