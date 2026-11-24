import { z } from "zod";

// Set before importing the shared schemas. Pages disallows dynamic code generation.
z.config({ jitless: true });
