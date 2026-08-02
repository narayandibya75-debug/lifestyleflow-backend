import fs from "fs";
import path from "path";

export class MetadataManager {
  private file: string;
  private tmpFile: string;

  constructor(folder: string) {
    this.file = path.join(folder, "metadata.json");
    this.tmpFile = path.join(folder, "metadata.json.tmp");
  }

  /**
   * Read metadata with resilience to corrupted JSON
   * Falls back to empty object or previous backup if available
   */
  read(): Record<string, any> {
    // Try to read the main file
    if (fs.existsSync(this.file)) {
      try {
        const content = fs.readFileSync(this.file, "utf8");
        
        // Handle empty file
        if (!content || content.trim() === "") {
          console.warn(`⚠️ Metadata file is empty: ${this.file}`);
          return {};
        }
        
        const data = JSON.parse(content);
        
        // Validate it's an object
        if (data && typeof data === "object" && !Array.isArray(data)) {
          return data;
        }
        
        console.warn(`⚠️ Metadata file contains invalid data (not an object): ${this.file}`);
      } catch (error) {
        console.error(`❌ Failed to parse metadata file: ${this.file}`, error);
        
        // Try to recover from temporary backup
        if (fs.existsSync(this.tmpFile)) {
          try {
            console.log(`🔄 Attempting to recover from backup: ${this.tmpFile}`);
            const backupContent = fs.readFileSync(this.tmpFile, "utf8");
            
            if (!backupContent || backupContent.trim() === "") {
              console.warn(`⚠️ Backup file is empty: ${this.tmpFile}`);
              return {};
            }
            
            const backupData = JSON.parse(backupContent);
            
            if (backupData && typeof backupData === "object" && !Array.isArray(backupData)) {
              console.log(`✅ Recovered metadata from backup`);
              // Restore the backup to the main file
              fs.writeFileSync(this.file, backupContent, "utf8");
              return backupData;
            }
          } catch (backupError) {
            console.error(`❌ Failed to recover from backup:`, backupError);
          }
        }
      }
    }

    // If all else fails, return empty object
    console.warn(`⚠️ Using empty metadata object for: ${this.file}`);
    return {};
  }

  /**
   * Write metadata using atomic operation with Windows compatibility
   * Preserves previous metadata on failure
   */
  write(data: Record<string, any>) {
    // Validate data is an object
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error(`Invalid metadata data: expected object, got ${typeof data}`);
    }

    const content = JSON.stringify(data, null, 2);
    
    try {
      // For Windows, try direct write first (more reliable)
      try {
        fs.writeFileSync(this.file, content, "utf8");
        return;
      } catch (directError) {
        console.warn(`⚠️ Direct write failed, trying atomic write...`);
      }

      // Step 1: Write to temporary file
      fs.writeFileSync(this.tmpFile, content, "utf8");
      
      // Step 2: Verify the temporary file was written correctly
      if (!fs.existsSync(this.tmpFile)) {
        throw new Error("Temporary file was not created");
      }
      
      // Step 3: Read back to verify it's valid JSON
      try {
        const verifyContent = fs.readFileSync(this.tmpFile, "utf8");
        JSON.parse(verifyContent);
      } catch (verifyError) {
        throw new Error(`Failed to verify temporary file: ${verifyError instanceof Error ? verifyError.message : String(verifyError)}`);
      }
      
      // Step 4: Atomic rename with Windows fallback
      try {
        fs.renameSync(this.tmpFile, this.file);
      } catch (renameError) {
        // If rename fails (Windows permission issue), try copy + unlink
        console.warn(`⚠️ Rename failed, trying copy + unlink fallback...`);
        fs.copyFileSync(this.tmpFile, this.file);
        if (fs.existsSync(this.tmpFile)) {
          try {
            fs.unlinkSync(this.tmpFile);
          } catch (unlinkError) {
            console.warn(`⚠️ Failed to clean up temporary file:`, unlinkError);
          }
        }
      }
      
    } catch (error) {
      // Clean up temporary file if it exists
      if (fs.existsSync(this.tmpFile)) {
        try {
          fs.unlinkSync(this.tmpFile);
          console.log(`🧹 Cleaned up temporary file: ${this.tmpFile}`);
        } catch (cleanupError) {
          console.warn(`⚠️ Failed to clean up temporary file:`, cleanupError);
        }
      }
      
      throw new Error(`Failed to write metadata: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Update metadata with resilience to failures
   * Preserves previous state if update fails
   */
  update(updates: Record<string, any>) {
    // Read current data (with resilience)
    const current = this.read();
    
    // Merge updates
    const newData = {
      ...current,
      ...updates,
    };
    
    // Write with atomic operation
    this.write(newData);
  }

  /**
   * Mark pipeline as failed with detailed error information
   * Preserves currentStep and stores lastError
   */
  markFailed(
    error: string,
    fallback: Record<string, any>
  ) {
    // Read current data (with resilience)
    let existing = this.read();
    
    // If no existing data, use fallback
    if (!existing || Object.keys(existing).length === 0) {
      existing = fallback;
    }
    
    // Preserve currentStep if it exists in the existing data
    const currentStep = existing.currentStep || "unknown";
    
    // Build the failed state with all error details
    const failedData = {
      ...existing,
      status: "failed",
      failedAt: new Date().toISOString(),
      error,
      lastError: error, // Store the last error for debugging
      currentStep: currentStep, // Preserve the step where failure occurred
      failureStep: currentStep, // Explicitly store the step that failed
      failureCount: (existing.failureCount || 0) + 1, // Track how many times it's failed
      lastAttemptAt: new Date().toISOString(),
    };
    
    // Attempt to write with atomic operation
    try {
      this.write(failedData);
    } catch (writeError) {
      console.error(`❌ Failed to write failed state:`, writeError);
      
      // Last resort: try direct write (may corrupt but better than nothing)
      try {
        const content = JSON.stringify(failedData, null, 2);
        fs.writeFileSync(this.file, content, "utf8");
        console.log(`⚠️ Wrote failed state directly (skipping atomic write)`);
      } catch (fallbackError) {
        console.error(`❌ Critical: Could not write failed state at all:`, fallbackError);
        // Re-throw the original error since we couldn't write the state
        throw new Error(`Failed to mark pipeline as failed: ${error}`);
      }
    }
  }

  /**
   * Helper method to check if metadata exists
   */
  exists(): boolean {
    return fs.existsSync(this.file);
  }

  /**
   * Helper method to get the current status
   */
  getStatus(): string {
    try {
      const data = this.read();
      return data.status || "unknown";
    } catch {
      return "unknown";
    }
  }

  /**
   * Helper method to check if the pipeline is in a failed state
   */
  isFailed(): boolean {
    try {
      const data = this.read();
      return data.status === "failed";
    } catch {
      return false;
    }
  }

  /**
   * Helper method to delete metadata file (for cleanup)
   */
  delete(): void {
    try {
      if (fs.existsSync(this.file)) {
        fs.unlinkSync(this.file);
      }
      if (fs.existsSync(this.tmpFile)) {
        fs.unlinkSync(this.tmpFile);
      }
    } catch (error) {
      console.warn(`⚠️ Failed to delete metadata:`, error);
    }
  }
}