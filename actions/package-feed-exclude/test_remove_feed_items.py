import unittest
from xml.dom import minidom

from remove_feed_items import remove_items

FEED = """<?xml version="1.0" encoding="UTF-8"?><rss xmlns:fhir="http://hl7.org/fhir/feed" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <channel>
    <title>Feed</title>
    <lastBuildDate>Tue, 20 Oct 2026 08:35:22 +0000</lastBuildDate>
    <pubDate>Tue, 20 Oct 2026 08:35:22 +0000</pubDate>
  
    <item>
      <title>inera.core.template#2.4.0</title>
      <link>https://fhir.inera.se/ig/template/2.4.0/package.tgz</link>
    </item>
    <item>
      <title>inera.lab.laboratory#1.0.0</title>
      <link>https://fhir.inera.se/ig/laboratory/1.0.0/package.tgz</link>
    </item>
    <item>
      <title>inera.core.template.extras#2.3.0</title>
      <link>https://fhir.inera.se/ig/template/2.3.0/inera.core.template.extras.tgz</link>
    </item>
    <item>
      <title>inera.core.templates#1.0.0</title>
      <link>https://fhir.inera.se/ig/templates/1.0.0/package.tgz</link>
    </item></channel>
</rss>"""


class RemoveItemsTest(unittest.TestCase):
    def test_removes_only_the_ig_and_its_sub_packages(self):
        text, count = remove_items(FEED, "inera.core.template")
        self.assertEqual(count, 2)
        self.assertNotIn("inera.core.template#", text)
        self.assertNotIn("inera.core.template.extras#", text)
        self.assertIn("inera.lab.laboratory#1.0.0", text)
        self.assertIn("inera.core.templates#1.0.0", text)
        minidom.parseString(text)

    def test_last_item_removed_leaves_valid_feed(self):
        text, _ = remove_items(FEED, "inera.core.templates")
        self.assertIn("</channel>", text)
        minidom.parseString(text)

    def test_no_match_changes_nothing(self):
        text, count = remove_items(FEED, "inera.other.ig")
        self.assertEqual(count, 0)
        self.assertEqual(text, FEED)


if __name__ == "__main__":
    unittest.main()
