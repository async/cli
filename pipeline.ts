import { definePipeline, env, job, sh, task, trigger } from "@async/pipeline";

const packageInputs = [
  "src/**/*.ts",
  "tests/**/*.test.js",
  "scripts/**/*.js",
  "README.md",
  "SPEC.md",
  "CHANGELOG.md",
  "AGENTS.md",
  "API_SURFACE.md",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json"
];

const buildInputs = ["src/**/*.ts", "tsconfig.json", "package.json"];

const pipelineInputs = [
  "pipeline.ts",
  "package.json",
  ".github/workflows/async-pipeline.yml",
  ".locks/pipeline/github-workflow.lock.json",
  ".locks/pipeline/tasks.lock.json"
];

export default definePipeline({
  name: "cli",
  cache: "file:local",
  triggers: {
    pr: trigger.github({ events: ["pull_request"] }),
    main: trigger.github({ events: ["push"], branches: ["main"] }),
    release: trigger.github({ events: ["release"], types: ["published"] }),
    manual: trigger.manual()
  },
  sync: {
    github: {
      nodeVersion: 24,
      cache: false,
      dependencyCache: false,
      packagePreviews: true
    },
    tasks: {
      prefix: "pipeline",
      runners: ["package"],
      targets: [{ package: "@async/cli" }],
      jobs: ["publish", "release-doctor", "snapshot", "verify"],
      tasks: ["build", "check", "github.check", "pack", "sync.check", "test", "typecheck"],
      scripts: {
        build: "run-task build",
        check: "run-task check",
        "github:check": "github check",
        "github:generate": "github generate",
        pack: "run-task pack",
        publish: "run publish",
        "publish:github:main": "publish github main --package .",
        "publish:github:pr": "publish github pr --package .",
        "publish:github:release": "publish github release --package .",
        "publish:npm": "publish npm --package .",
        "release:doctor": "release doctor --package .",
        "release:ensure": "release ensure --package .",
        "release-doctor": "run release-doctor",
        snapshot: "run snapshot",
        "sync:check": "sync check",
        "sync:generate": "sync generate",
        test: "run-task test",
        typecheck: "run-task typecheck",
        verify: "run verify",
        "verify:force": "run verify --force"
      }
    }
  },
  tasks: {
    build: task({
      description: "Compile the TypeScript CLI sources into dist.",
      inputs: buildInputs,
      outputs: ["dist/**"],
      cache: false,
      run: sh`pnpm exec tsc -p tsconfig.json && chmod +x dist/cli.js`
    }),
    typecheck: task({
      description: "Validate the TypeScript CLI sources without writing output.",
      inputs: packageInputs,
      cache: false,
      run: sh`pnpm exec tsc -p tsconfig.json --noEmit`
    }),
    check: task({
      description: "Run scaffold, metadata, and public surface checks.",
      dependsOn: ["build"],
      inputs: packageInputs,
      cache: false,
      run: sh`node scripts/check.js`
    }),
    test: task({
      description: "Run the CLI router and agent integration tests.",
      dependsOn: ["build"],
      inputs: packageInputs,
      cache: false,
      run: sh`node --test tests/*.test.js`
    }),
    "sync.check": task({
      description: "Validate generated package scripts and task locks from pipeline.ts.",
      inputs: pipelineInputs,
      cache: false,
      run: sh`pnpm async-pipeline sync check`
    }),
    "github.check": task({
      description: "Validate generated GitHub Actions workflow and lock state from pipeline.ts.",
      inputs: pipelineInputs,
      cache: false,
      run: sh`pnpm async-pipeline github check`
    }),
    pack: task({
      description: "Verify the public npm package contents without publishing.",
      dependsOn: ["check", "test", "sync.check", "github.check"],
      inputs: [...packageInputs, ...pipelineInputs],
      cache: false,
      run: sh`pnpm run pack:check`
    }),
    snapshot: task({
      description: "Publish main snapshots to GitHub Packages.",
      dependsOn: ["pack"],
      inputs: packageInputs,
      cache: false,
      run: sh`pnpm async-pipeline publish github main --package .`
    }),
    "release.ensure": task({
      description: "Create or verify the release tag and GitHub Release before package publishing.",
      dependsOn: ["pack"],
      inputs: packageInputs,
      cache: false,
      run: sh`pnpm async-pipeline release ensure --package .`
    }),
    "publish.github": task({
      description: "Publish the stable GitHub Packages mirror before npm publishing.",
      dependsOn: ["release.ensure"],
      inputs: packageInputs,
      cache: false,
      run: sh`pnpm async-pipeline publish github release --package .`
    }),
    publish: task({
      description: "Publish the verified release to npm, then run release doctor.",
      dependsOn: ["publish.github"],
      inputs: packageInputs,
      cache: false,
      run: [
        sh`pnpm async-pipeline publish npm --package .`,
        sh`pnpm async-pipeline release doctor --package .`
      ]
    }),
    "release.doctor": task({
      description: "Diagnose release consistency for the current version.",
      dependsOn: ["pack"],
      inputs: packageInputs,
      cache: false,
      run: sh`pnpm async-pipeline release doctor --package .`
    })
  },
  jobs: {
    verify: job({
      description: "Build, check, test, generated-workflow check, and package dry-run.",
      target: "pack",
      trigger: ["pr", "main", "release", "manual"]
    }),
    snapshot: job({
      description: "Publish a main-branch snapshot to GitHub Packages.",
      target: "snapshot",
      trigger: ["main"],
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      },
      github: {
        permissions: {
          contents: "write",
          packages: "write"
        }
      }
    }),
    publish: job({
      description: "Publish the release to GitHub Packages and npm.",
      target: "publish",
      trigger: ["manual", "release"],
      environment: {
        name: "npm-publish",
        url: "https://www.npmjs.com/package/@async/cli"
      },
      requires: {
        provenance: true
      },
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN"),
        NODE_AUTH_TOKEN: env.secret("NPM_TOKEN")
      },
      github: {
        permissions: {
          contents: "write",
          idToken: "write",
          packages: "write"
        }
      }
    }),
    "release-doctor": job({
      description: "Diagnose release consistency for the current version.",
      target: "release.doctor",
      trigger: ["manual"],
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      },
      github: {
        permissions: {
          contents: "read",
          packages: "read"
        }
      }
    })
  }
});
