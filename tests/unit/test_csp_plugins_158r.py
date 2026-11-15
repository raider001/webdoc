"""Re-merge of 158: the style policy a renderer plugin forces, and nothing more.

154E's policy is style-src 'self'. The Software Designer library styles itself
inline (run-time <style> elements; style attributes in its editor), so a site
that enables the software-design plugin gets the pre-154E style policy back -
for styles only. Every other site, and script-src everywhere, stays strict.
"""
import tempfile
import unittest

import serve
import webdoc_auth


def directives(policy):
    return {part.split()[0]: part.strip() for part in policy.split(';') if part.strip()}


class PluginStylePolicy(unittest.TestCase):
    def setUp(self):
        home = tempfile.TemporaryDirectory(prefix='csp-158r-')
        self.addCleanup(home.cleanup)
        self.home = home.name
        self.auth = webdoc_auth.AuthConfig({}, self.home)

    def test_without_the_plugin_styles_stay_strict(self):
        for plugins in ((), [], ['mermaid', 'widget-panel']):
            policy = serve.build_csp(self.auth, plugins)
            self.assertNotIn("'unsafe-inline'", policy)
            self.assertEqual(directives(policy)['style-src'], "style-src 'self'")
        self.assertEqual(serve.build_csp(self.auth), serve.build_csp(self.auth, ['mermaid']))

    def test_the_software_design_plugin_relaxes_styles_only(self):
        strict = directives(serve.build_csp(self.auth, ['mermaid']))
        relaxed = directives(serve.build_csp(self.auth, ['mermaid', 'software-design']))
        self.assertEqual(relaxed['style-src'], "style-src 'self' 'unsafe-inline'")
        self.assertNotIn("'unsafe-inline'", relaxed['script-src'])
        self.assertEqual({k: v for k, v in relaxed.items() if k != 'style-src'},
                         {k: v for k, v in strict.items() if k != 'style-src'})
        self.assertEqual(serve.inline_style_plugins(['software-design', 'mermaid']), ['software-design'])

    def test_no_headers_means_no_policy(self):
        quiet = webdoc_auth.AuthConfig({'securityHeaders': False}, self.home)
        self.assertIsNone(serve.build_csp(quiet, ['software-design']))

    def test_a_script_or_style_element_override_still_cannot_weaken_it(self):
        for override in ("script-src * 'unsafe-inline'", "style-src-elem *", "style-src-attr 'unsafe-inline'"):
            self.auth.content_security_policy = override
            with self.assertRaises(ValueError):
                serve.build_csp(self.auth, ['software-design'])


if __name__ == '__main__':
    unittest.main()
