package com.cnaichat.app;

import android.content.Context;
import android.util.Log;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

import java.io.InputStream;
import java.nio.LongBuffer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * ONNX Runtime embedding generator
 * Uses MiniLM model for text embeddings
 */
public class EmbeddingGenerator {
    private static final String TAG = "EmbeddingGenerator";
    private static final int EMBEDDING_DIM = 384;
    private static final String MODEL_FILE = "model_quantized.onnx";

    private OrtEnvironment env;
    private OrtSession session;
    private boolean isInitialized = false;
    private String initError = null;

    public interface InitCallback {
        void onSuccess();
        void onError(String message);
    }

    public interface EmbeddingCallback {
        void onResult(float[] embedding);
        void onError(String message);
    }

    public interface EmbeddingsCallback {
        void onResult(List<float[]> embeddings);
        void onError(String message);
    }

    public EmbeddingGenerator() {
    }

    /**
     * Initialize the model (async)
     */
    public void initializeAsync(Context context, InitCallback callback) {
        new Thread(() -> {
            try {
                initialize(context);
                isInitialized = true;
                Log.d(TAG, "EmbeddingGenerator initialized successfully");
                callback.onSuccess();
            } catch (Exception e) {
                Log.e(TAG, "Failed to initialize", e);
                initError = e.getMessage();
                callback.onError(e.getMessage());
            }
        }).start();
    }

    private void initialize(Context context) throws Exception {
        env = OrtEnvironment.getEnvironment();

        // Try to load model from assets
        InputStream is = context.getAssets().open("www/models/minilm/model_quantized.onnx");
        byte[] modelBytes = readAllBytes(is);
        is.close();

        session = env.createSession(modelBytes);
        Log.d(TAG, "Model loaded, input names: " + session.getInputNames());
        Log.d(TAG, "Model loaded, output names: " + session.getOutputNames());
    }

    private byte[] readAllBytes(InputStream is) throws Exception {
        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int len;
        while ((len = is.read(buffer)) != -1) {
            baos.write(buffer, 0, len);
        }
        return baos.toByteArray();
    }

    /**
     * Generate embedding from tokenized input
     * @param inputIds token IDs from tokenizer (long[])
     * @param attentionMask attention mask (long[], usually all 1s)
     */
    public float[] generateEmbedding(long[] inputIds, long[] attentionMask) {
        if (!isInitialized) {
            Log.e(TAG, "Not initialized");
            return null;
        }

        try {
            // Create input tensors
            long[] shape = {1, inputIds.length};

            OnnxTensor inputIdsTensor = OnnxTensor.createTensor(env, LongBuffer.wrap(inputIds), shape);
            OnnxTensor attentionMaskTensor = OnnxTensor.createTensor(env, LongBuffer.wrap(attentionMask), shape);

            // Create input map
            Map<String, OnnxTensor> inputs = new HashMap<>();
            inputs.put("input_ids", inputIdsTensor);
            inputs.put("attention_mask", attentionMaskTensor);

            // Check if model requires token_type_ids (some BERT models do)
            if (session.getInputNames().contains("token_type_ids")) {
                long[] tokenTypeIds = new long[inputIds.length]; // all zeros for single sentence
                OnnxTensor tokenTypeIdsTensor = OnnxTensor.createTensor(env, LongBuffer.wrap(tokenTypeIds), shape);
                inputs.put("token_type_ids", tokenTypeIdsTensor);
                Log.d(TAG, "Added token_type_ids input");
            }

            Log.d(TAG, "Running inference with inputs: " + inputs.keySet() + ", shape: " + inputIds.length);

            // Run inference
            OrtSession.Result result = session.run(inputs);

            // Get output - try to handle different output formats
            Object outputValue = result.get(0).getValue();
            float[][] tokenEmbeddings;

            if (outputValue instanceof float[][][]) {
                // Standard format: [batch_size, seq_len, hidden_dim]
                tokenEmbeddings = ((float[][][]) outputValue)[0];
                Log.d(TAG, "Output format: float[][][], shape approx: 1x" + tokenEmbeddings.length + "x" + (tokenEmbeddings.length > 0 ? tokenEmbeddings[0].length : 0));
            } else if (outputValue instanceof float[][]) {
                // Some models output [seq_len, hidden_dim] directly
                tokenEmbeddings = (float[][]) outputValue;
                Log.d(TAG, "Output format: float[][], shape: " + tokenEmbeddings.length + "x" + (tokenEmbeddings.length > 0 ? tokenEmbeddings[0].length : 0));
            } else {
                Log.e(TAG, "Unexpected output type: " + outputValue.getClass().getName());
                return null;
            }

            // Mean pooling over sequence dimension
            float[] embedding = meanPooling(tokenEmbeddings, attentionMask);

            // Cleanup
            inputIdsTensor.close();
            attentionMaskTensor.close();
            if (inputs.containsKey("token_type_ids")) {
                inputs.get("token_type_ids").close();
            }
            result.close();

            Log.d(TAG, "Generated embedding successfully, dimension: " + embedding.length);
            return embedding;

        } catch (Exception e) {
            Log.e(TAG, "Error generating embedding: " + e.getMessage(), e);
            return null;
        }
    }

    /**
     * Mean pooling over sequence tokens
     */
    private float[] meanPooling(float[][] tokenEmbeddings, long[] attentionMask) {
        float[] result = new float[EMBEDDING_DIM];
        float sumMask = 0;

        for (int i = 0; i < tokenEmbeddings.length; i++) {
            if (attentionMask[i] == 1) {
                sumMask += 1;
                for (int j = 0; j < EMBEDDING_DIM; j++) {
                    result[j] += tokenEmbeddings[i][j];
                }
            }
        }

        // Normalize
        if (sumMask > 0) {
            for (int j = 0; j < EMBEDDING_DIM; j++) {
                result[j] /= sumMask;
            }
        }

        // L2 normalize
        float norm = 0;
        for (int j = 0; j < EMBEDDING_DIM; j++) {
            norm += result[j] * result[j];
        }
        norm = (float) Math.sqrt(norm);
        if (norm > 0) {
            for (int j = 0; j < EMBEDDING_DIM; j++) {
                result[j] /= norm;
            }
        }

        return result;
    }

    /**
     * Generate embedding from text string (uses JS tokenizer)
     * This method receives pre-tokenized input from JS
     */
    public String generateEmbeddingJson(String inputIdsJson, String attentionMaskJson) {
        if (!isInitialized) {
            String err = initError != null ? initError : "not_initialized";
            return "{\"error\":\"" + err.replace("\"", "\\\"") + "\"}";
        }

        try {
            // Parse JSON arrays
            long[] inputIds = parseJsonLongArray(inputIdsJson);
            long[] attentionMask = parseJsonLongArray(attentionMaskJson);

            Log.d(TAG, "Parsed input: inputIds.length=" + inputIds.length + ", attentionMask.length=" + attentionMask.length);

            float[] embedding = generateEmbedding(inputIds, attentionMask);

            if (embedding == null) {
                return "{\"error\":\"generation_failed\",\"input_len\":" + inputIds.length + "}";
            }

            // Convert to JSON array
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < embedding.length; i++) {
                if (i > 0) sb.append(",");
                sb.append(embedding[i]);
            }
            sb.append("]");
            return sb.toString();

        } catch (Exception e) {
            Log.e(TAG, "Error in generateEmbeddingJson", e);
            return "{\"error\":\"" + e.getMessage().replace("\"", "\\\"") + "\"}";
        }
    }

    private long[] parseJsonLongArray(String json) {
        json = json.trim();
        if (json.startsWith("[")) json = json.substring(1);
        if (json.endsWith("]")) json = json.substring(0, json.length() - 1);

        String[] parts = json.split(",");
        long[] result = new long[parts.length];
        for (int i = 0; i < parts.length; i++) {
            result[i] = Long.parseLong(parts[i].trim());
        }
        return result;
    }

    public boolean isInitialized() {
        return isInitialized;
    }

    public String getInitError() {
        return initError;
    }

    public void close() {
        if (session != null) {
            try {
                session.close();
            } catch (Exception e) {
                Log.e(TAG, "Error closing session", e);
            }
            session = null;
        }
        isInitialized = false;
    }
}