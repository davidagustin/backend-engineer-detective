import type { DetectiveCase } from "../../types";

export const jvmMetaspaceLeak: DetectiveCase = {
	id: "jvm-metaspace-leak",
	title: "The Invisible Memory Drain",
	subtitle: "Memory leak in Metaspace from class loaders not being garbage collected",
	difficulty: "senior",
	category: "memory",

	crisis: {
		description:
			"Your Java application's memory grows steadily until it crashes with 'java.lang.OutOfMemoryError: Metaspace'. Heap memory looks fine, GC is running normally, but something is consuming native memory. The problem gets worse with each deployment/restart cycle.",
		impact:
			"Application crashes every 2-3 days requiring restart. Native memory grows unbounded. Metaspace exhausted despite adequate heap. Operations team frustrated with manual restarts.",
		timeline: [
			{ time: "Day 1, 00:00", event: "Application deployed, Metaspace at 128MB", type: "normal" },
			{ time: "Day 1, 12:00", event: "Metaspace at 256MB after hot-deploys", type: "normal" },
			{ time: "Day 2, 00:00", event: "Metaspace at 512MB, growing steadily", type: "warning" },
			{ time: "Day 2, 18:00", event: "Metaspace at 900MB, approaching limit", type: "warning" },
			{ time: "Day 3, 06:00", event: "OutOfMemoryError: Metaspace, crash", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Heap memory usage is normal",
			"GC runs successfully and reclaims heap",
			"Application functions correctly between crashes",
			"No heap-related OutOfMemoryErrors",
			"Response times are acceptable",
		],
		broken: [
			"Metaspace grows continuously over time",
			"OutOfMemoryError: Metaspace crashes",
			"Memory grows faster with hot-deploys",
			"Restart temporarily fixes but leak returns",
			"Native memory monitoring shows growth",
		],
	},

	clues: [
		{
			id: 1,
			title: "Metaspace Metrics Over Time",
			type: "metrics",
			content: `\`\`\`
JMX Metaspace Monitoring:

Time             | Used     | Committed | Max
-----------------|----------|-----------|--------
Day 1, 00:00     | 87 MB    | 128 MB    | 1024 MB
Day 1, 06:00     | 124 MB   | 192 MB    | 1024 MB
Day 1, 12:00     | 234 MB   | 320 MB    | 1024 MB  <- After hot-deploy
Day 1, 18:00     | 312 MB   | 384 MB    | 1024 MB
Day 2, 00:00     | 456 MB   | 512 MB    | 1024 MB
Day 2, 06:00     | 567 MB   | 640 MB    | 1024 MB
Day 2, 12:00     | 678 MB   | 768 MB    | 1024 MB  <- Another hot-deploy
Day 2, 18:00     | 812 MB   | 896 MB    | 1024 MB
Day 3, 00:00     | 923 MB   | 960 MB    | 1024 MB
Day 3, 06:00     | OOME     | -         | -

Class Statistics:
  Loaded classes: 147,234
  Unloaded classes: 234        <-- Very few unloaded!
  Active class loaders: 1,247  <-- Should be ~10-20
\`\`\``,
			hint: "147K classes loaded but only 234 unloaded - class loaders are leaking",
		},
		{
			id: 2,
			title: "Class Loader Hierarchy Dump",
			type: "logs",
			content: `\`\`\`
$ jcmd <pid> GC.class_histogram | head -50

 num     #instances         #bytes  class name
------------------------------------------------------
   1:        847234       67778720  [C (char arrays)
   2:        234567       18765360  java.lang.String
   3:        123456        9876480  java.lang.reflect.Method
   4:         45678        7308480  java.lang.Class
   5:         12345        4938000  groovy.lang.MetaClassImpl
   6:         12344        2962560  groovy.lang.MetaMethod
   7:         12343        1975840  org.codehaus.groovy.runtime.callsite.CallSite
...

$ jcmd <pid> VM.classloader_stats

ClassLoader                                        | #classes | parent
-------------------------------------------------|----------|--------
GroovyClassLoader@1a2b3c4d                        | 1,234    | AppCL
GroovyClassLoader@2b3c4d5e                        | 1,234    | AppCL
GroovyClassLoader@3c4d5e6f                        | 1,234    | AppCL
... (1,200+ GroovyClassLoaders!)
WebappClassLoader@4d5e6f70                        | 8,456    | SystemCL
WebappClassLoader@5e6f7081                        | 8,456    | SystemCL
WebappClassLoader@6f708192                        | 8,456    | SystemCL
... (50+ WebappClassLoaders!)

# Each hot-deploy creates new class loaders
# Old class loaders not garbage collected
\`\`\``,
			hint: "1,200+ GroovyClassLoaders and 50+ WebappClassLoaders should never happen",
		},
		{
			id: 3,
			title: "Scripting Engine Code",
			type: "code",
			content: `\`\`\`java
@Service
public class RuleEngineService {
    private final ScriptEngineManager manager = new ScriptEngineManager();

    public Object executeRule(String ruleScript, Map<String, Object> context) {
        // Get a fresh Groovy engine for each execution
        ScriptEngine engine = manager.getEngineByName("groovy");

        // Bind context variables
        Bindings bindings = engine.createBindings();
        bindings.putAll(context);

        try {
            // Compile and execute the rule
            CompiledScript compiled = ((Compilable) engine).compile(ruleScript);
            return compiled.eval(bindings);
        } catch (ScriptException e) {
            throw new RuleExecutionException(e);
        }
    }
}

// Called thousands of times per day
// Each compile() creates new classes in a new class loader
// Class loaders never get garbage collected
\`\`\``,
			hint: "Each compile() creates new classes - and those classes never get unloaded...",
		},
		{
			id: 4,
			title: "GC Roots Analysis",
			type: "logs",
			content: `\`\`\`
Heap dump analysis with Eclipse MAT:

Leak Suspects Report:
======================

Problem Suspect 1:
  1,247 instances of "groovy.lang.GroovyClassLoader"
  loaded by "jdk.internal.loader.ClassLoaders$AppClassLoader @ 0x7f8b2c"

  These class loaders occupy 847,234,567 bytes.

  GC Root Path (example):
  GroovyClassLoader@1a2b3c4d
    <- classes (field) of java.lang.Class
    <- soft reference from org.codehaus.groovy.reflection.ClassInfo$1
    <- classInfo (field) of org.codehaus.groovy.reflection.ClassInfo
    <- softBundle (field) of groovy.lang.MetaClassImpl
    <- globalMetaClassRegistry (static) of groovy.lang.MetaClassRegistryImpl
    <- INSTANCE (static) of groovy.lang.GroovySystem$1

# The class loaders are retained by Groovy's global MetaClass registry
# Even when we're "done" with the script, references remain
\`\`\``,
			hint: "Class loaders retained by Groovy's global MetaClass registry",
		},
		{
			id: 5,
			title: "JVM Memory Model Diagram",
			type: "logs",
			content: `\`\`\`
JVM Memory Areas:

┌────────────────────────────────────────────────────────────────┐
│                         JVM Process                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  HEAP (managed by GC)                    [Xmx: 4GB]      │  │
│  │  ├── Young Generation (Eden + Survivor)                  │  │
│  │  └── Old Generation                                      │  │
│  │                                                          │  │
│  │  Status: HEALTHY - GC working, plenty of space           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  METASPACE (class metadata)         [MaxMetaspace: 1GB]  │  │
│  │  ├── Class metadata                                      │  │
│  │  ├── Method bytecode                                     │  │
│  │  ├── Constant pools                                      │  │
│  │  └── Interned strings (moved in JDK 7+)                  │  │
│  │                                                          │  │
│  │  Status: LEAKING - grows unbounded, classes not unloaded │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  NATIVE MEMORY (direct buffers, JNI, etc.)               │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

Classes can ONLY be unloaded when their ClassLoader is GC'd.
ClassLoader can ONLY be GC'd when no references exist to:
  - The ClassLoader itself
  - Any Class loaded by it
  - Any instance of any Class loaded by it
\`\`\``,
		},
		{
			id: 6,
			title: "DevOps Engineer Testimony",
			type: "testimony",
			content: `"We enabled hot-deployment in production to speed up our release cycle - no more downtime for deploys. But ever since then, the Metaspace issue got way worse. We also have this rule engine that lets business users write Groovy scripts for custom logic. The scripts are stored in the database and executed on demand. I thought scripting engines were designed to be used this way? The weird thing is, we're not leaking heap memory - just Metaspace."`,
		},
	],

	solution: {
		diagnosis: "Metaspace leak from GroovyClassLoaders retained by global MetaClass registry preventing class unloading",
		keywords: [
			"Metaspace",
			"class loader leak",
			"ClassLoader",
			"Groovy",
			"ScriptEngine",
			"class unloading",
			"MetaClassRegistry",
			"hot deploy",
			"PermGen",
		],
		rootCause: `Every time compile() is called on a Groovy ScriptEngine, it creates new classes in a new GroovyClassLoader. These classes contain:
- The compiled script bytecode
- Generated accessor methods
- Closure classes

For a class to be unloaded, its ClassLoader must be garbage collected. But Groovy's global MetaClassRegistry keeps soft references to MetaClass objects, which reference the classes, which reference the ClassLoader.

The retention chain:
1. GroovySystem.INSTANCE holds MetaClassRegistryImpl
2. MetaClassRegistryImpl holds MetaClassImpl for each class
3. MetaClassImpl holds reference to the Class
4. Class holds reference to GroovyClassLoader
5. GroovyClassLoader cannot be GC'd

Hot-deploys make it worse:
- Each deploy creates new WebappClassLoader
- Old classloader still referenced by:
  - ThreadLocals not cleared
  - Static references in libraries
  - Shutdown hooks
  - JDBC drivers registered with DriverManager

Result: Metaspace fills with unreachable but unreleasable class metadata.`,
		codeExamples: [
			{
				lang: "java",
				description: "Fix 1: Cache compiled scripts instead of recompiling",
				code: `@Service
public class RuleEngineService {
    private final ScriptEngine engine;
    private final Map<String, CompiledScript> scriptCache = new ConcurrentHashMap<>();

    public RuleEngineService() {
        // Single engine, reused
        ScriptEngineManager manager = new ScriptEngineManager();
        this.engine = manager.getEngineByName("groovy");
    }

    public Object executeRule(String ruleScript, Map<String, Object> context) {
        // Get or compile script (cached)
        CompiledScript compiled = scriptCache.computeIfAbsent(
            hashScript(ruleScript),
            key -> compileScript(ruleScript)
        );

        // Execute with fresh bindings (safe for concurrency)
        Bindings bindings = engine.createBindings();
        bindings.putAll(context);

        try {
            return compiled.eval(bindings);
        } catch (ScriptException e) {
            throw new RuleExecutionException(e);
        }
    }

    private CompiledScript compileScript(String script) {
        try {
            return ((Compilable) engine).compile(script);
        } catch (ScriptException e) {
            throw new RuleCompilationException(e);
        }
    }

    private String hashScript(String script) {
        return DigestUtils.sha256Hex(script);
    }
}`,
			},
			{
				lang: "java",
				description: "Fix 2: Use GroovyShell with class cache clearing",
				code: `@Service
public class RuleEngineService {
    private final GroovyShell shell;
    private final Map<String, Script> scriptCache = new ConcurrentHashMap<>();

    public RuleEngineService() {
        CompilerConfiguration config = new CompilerConfiguration();
        config.setOptimizationOptions(Collections.singletonMap("indy", true));

        this.shell = new GroovyShell(config);
    }

    public Object executeRule(String ruleScript, Map<String, Object> context) {
        Script script = scriptCache.computeIfAbsent(
            DigestUtils.sha256Hex(ruleScript),
            key -> shell.parse(ruleScript)
        );

        // Clone script for thread safety
        Script instance = (Script) script.getClass()
            .getDeclaredConstructor().newInstance();

        Binding binding = new Binding(context);
        instance.setBinding(binding);

        return instance.run();
    }

    @Scheduled(fixedRate = 3600000) // Hourly
    public void clearClassCache() {
        // Clear Groovy's MetaClass registry to allow GC
        GroovySystem.getMetaClassRegistry().removeMetaClass(Script.class);

        // Clear cache if too large
        if (scriptCache.size() > 1000) {
            scriptCache.clear();
        }
    }
}`,
			},
			{
				lang: "java",
				description: "Fix 3: Use GraalVM JavaScript (no ClassLoader per script)",
				code: `@Service
public class RuleEngineService {
    private final Engine engine;
    private final Map<String, Source> sourceCache = new ConcurrentHashMap<>();

    public RuleEngineService() {
        // GraalVM polyglot engine - doesn't create classloaders
        this.engine = Engine.newBuilder()
            .option("engine.WarnInterpreterOnly", "false")
            .build();
    }

    public Object executeRule(String ruleScript, Map<String, Object> context) {
        Source source = sourceCache.computeIfAbsent(
            DigestUtils.sha256Hex(ruleScript),
            key -> Source.newBuilder("js", ruleScript, "rule.js").buildLiteral()
        );

        try (Context ctx = Context.newBuilder("js")
                .engine(engine)
                .allowAllAccess(true)
                .build()) {

            // Bind context variables
            Value bindings = ctx.getBindings("js");
            context.forEach(bindings::putMember);

            // Execute - no new classes created
            return ctx.eval(source).as(Object.class);
        }
    }
}

// GraalVM approach:
// - No new ClassLoaders per script
// - Scripts compiled to GraalVM IR, not JVM bytecode
// - Much better memory behavior for dynamic scripting`,
			},
			{
				lang: "bash",
				description: "Fix 4: Monitor and limit Metaspace",
				code: `# JVM flags for Metaspace management
java -XX:MaxMetaspaceSize=512m \\
     -XX:MetaspaceSize=256m \\
     -XX:+UseG1GC \\
     -XX:+ClassUnloadingWithConcurrentMark \\
     -XX:+CMSClassUnloadingEnabled \\
     -Xlog:class+unload=info \\
     -Xlog:gc+metaspace=debug \\
     -jar application.jar

# Monitoring commands
jcmd <pid> GC.class_stats           # Detailed class statistics
jcmd <pid> VM.classloader_stats     # ClassLoader counts
jcmd <pid> VM.native_memory summary # Native memory breakdown

# Alerts to set:
# - Metaspace usage > 80% of max
# - Class loader count growing continuously
# - Classes loaded >> classes unloaded`,
			},
		],
		prevention: [
			"Cache compiled scripts/classes instead of recompiling",
			"Use a single shared scripting engine instance",
			"Explicitly clear Groovy MetaClass registry periodically",
			"Avoid hot-deployment in production (use rolling restart)",
			"Monitor class loader count and Metaspace usage",
			"Set -XX:MaxMetaspaceSize to fail fast instead of grow forever",
		],
		educationalInsights: [
			"Metaspace replaced PermGen in Java 8 but leaks are still possible",
			"Classes can only be unloaded when their ClassLoader is collected",
			"Each Groovy compile() typically creates a new ClassLoader",
			"Soft references in registries prevent ClassLoader GC",
			"Hot-deploy creates new ClassLoaders - old ones may not be released",
			"Native Memory Tracking (-XX:NativeMemoryTracking) helps diagnose",
		],
	},
};
