//! Compare UI task identity while the caller holds its process-manager lock.
//! A missing identity never authorizes stopping a replacement process.
pub(crate) fn verify_expected_run(expected: Option<&str>, actual: Option<&str>) -> Result<(), &'static str> {
    match (expected, actual) {
        (Some(expected), Some(actual)) if !expected.is_empty() && expected == actual => Ok(()),
        _ => Err("TASK_RUN_CHANGED"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_the_exact_recorded_run_can_be_stopped() {
        assert!(verify_expected_run(Some("run-A"), Some("run-A")).is_ok());
        assert!(verify_expected_run(Some("run-A"), Some("run-B")).is_err());
        assert!(verify_expected_run(None, Some("run-A")).is_err());
        assert!(verify_expected_run(Some("run-A"), None).is_err());
        assert!(verify_expected_run(None, None).is_err());
        assert!(verify_expected_run(Some(""), Some("")).is_err());
    }
}
