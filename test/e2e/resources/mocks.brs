sub Main()
    ' testing mock objects with functions
    _brs_.mockComponent("roTimespan", {
        mark: (sub()
            print "marking mock timespan"
        end sub),
        totalMilliseconds: (function()
            return 8
        end function)
    })
    mockTimespan = createObject("roTimespan")
    mockTimespan.mark()
    print "mocked timespan should return 8: " mockTimespan.totalMilliseconds()  ' => 8

    ' testing the type of mocked objects
    realRegex = createObject("roRegex", "[a-z]+", "i")
    print "create object regex:" type(realRegex)

    _brs_.mockComponent("roRegex", {})
    mockRegex = createObject("roRegex", "a-z+", "i")
    print "mock object regex:" type(mockRegex)

    ' testing mock objects with fields, functions and parameters
    _brs_.mockComponent("roSGNode", {
        getChild: (function(index as integer)
            return { index: index }
        end function)
    })
    mockNode = createObject("roSGNode", "Node")
    mockNode.id = "node-id"
    mockNode.name = "node-name"
    mockChild = mockNode.getChild(333)

    print "mocked node id:" mockNode.id                     ' => node-id
    print "mocked node name:" mockNode.name                 ' => node-name
    print "mocked node child index:" mockChild.index        ' => 333

end sub
