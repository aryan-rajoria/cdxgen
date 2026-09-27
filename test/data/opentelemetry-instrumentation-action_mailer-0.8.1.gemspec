# -*- encoding: utf-8 -*-
# stub: opentelemetry-instrumentation-action_mailer 0.8.1 ruby lib

Gem::Specification.new do |s|
  s.name = "opentelemetry-instrumentation-action_mailer".freeze
  s.version = "0.8.1".freeze

  s.required_rubygems_version = Gem::Requirement.new(">= 0".freeze) if s.respond_to? :required_rubygems_version=
  s.metadata = { "bug_tracker_uri" => "https://github.com/open-telemetry/opentelemetry-ruby-contrib/issues", "changelog_uri" => "https://rubydoc.info/gems/opentelemetry-instrumentation-action_mailer/0.8.1/file/CHANGELOG.md", "documentation_uri" => "https://rubydoc.info/gems/opentelemetry-instrumentation-action_mailer/0.8.1", "source_code_uri" => "https://github.com/open-telemetry/opentelemetry-ruby-contrib/tree/opentelemetry-instrumentation-action_mailer/v0.8.1/instrumentation/action_mailer" } if s.respond_to? :metadata=
  s.require_paths = ["lib".freeze]
  s.authors = ["OpenTelemetry Authors".freeze]
  s.date = "2026-09-26"
  s.description = "ActionMailer instrumentation for the OpenTelemetry framework".freeze
  s.email = ["cncf-opentelemetry-contributors@lists.cncf.io".freeze]
  s.files = [".yardopts".freeze, "CHANGELOG.md".freeze, "LICENSE".freeze, "README.md".freeze, "lib/opentelemetry-instrumentation-action_mailer.rb".freeze, "lib/opentelemetry/instrumentation.rb".freeze, "lib/opentelemetry/instrumentation/action_mailer.rb".freeze, "lib/opentelemetry/instrumentation/action_mailer/instrumentation.rb".freeze, "lib/opentelemetry/instrumentation/action_mailer/railtie.rb".freeze, "lib/opentelemetry/instrumentation/action_mailer/version.rb".freeze]
  s.homepage = "https://github.com/open-telemetry/opentelemetry-ruby-contrib".freeze
  s.licenses = ["Apache-2.0".freeze]
  s.required_ruby_version = Gem::Requirement.new(">= 3.3".freeze)
  s.rubygems_version = "3.5.16".freeze
  s.summary = "ActionMailer instrumentation for the OpenTelemetry framework".freeze

  s.specification_version = 4

  s.add_runtime_dependency(%q<opentelemetry-instrumentation-active_support>.freeze, ["~> 0.10".freeze])
end

