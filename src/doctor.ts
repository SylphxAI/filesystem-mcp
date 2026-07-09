import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRustCliBinary } from './engine/rust-policy.js'

export type DoctorStatus = 'ok' | 'warn' | 'fail'

export interface DoctorCheck {
	id: string
	status: DoctorStatus
	message: string
}

export interface DoctorReport {
	profile: 'filesystem_doctor'
	version: string
	status: 'ready' | 'degraded' | 'unavailable'
	checks: DoctorCheck[]
}

const here = path.dirname(fileURLToPath(import.meta.url))

const probeNode = (): DoctorCheck => {
	const version = process.versions.node
	const major = Number.parseInt(version.split('.')[0] ?? '0', 10)
	if (major >= 22) {
		return {
			id: 'node',
			status: 'ok',
			message: `Node.js ${version} meets the >=22.14 requirement.`,
		}
	}

	return {
		id: 'node',
		status: 'warn',
		message: `Node.js ${version} is below the recommended >=22.14 runtime.`,
	}
}

const probeRustPolicyBinary = (): DoctorCheck => {
	const binary = resolveRustCliBinary()
	if (binary !== 'filesystem-cli' && existsSync(binary)) {
		return {
			id: 'rust_policy_cli',
			status: 'ok',
			message: `Rust policy CLI is available at ${binary}.`,
		}
	}

	const release = path.join(here, '../target/release/filesystem-cli')
	const debug = path.join(here, '../target/debug/filesystem-cli')
	if (existsSync(release) || existsSync(debug)) {
		return {
			id: 'rust_policy_cli',
			status: 'ok',
			message: 'Rust policy CLI is built locally.',
		}
	}

	return {
		id: 'rust_policy_cli',
		status: 'warn',
		message:
			'Rust policy CLI is not built. Run `cargo build --release` to enable FILESYSTEM_USE_RUST_POLICY=1.',
	}
}

export function runDoctor(version: string): DoctorReport {
	const checks = [probeNode(), probeRustPolicyBinary()]
	const status = checks.some((check) => check.status === 'fail')
		? 'unavailable'
		: checks.some((check) => check.status === 'warn')
			? 'degraded'
			: 'ready'

	return {
		profile: 'filesystem_doctor',
		version,
		status,
		checks,
	}
}

export function formatDoctorReport(report: DoctorReport): string {
	return JSON.stringify(report, null, 2)
}
